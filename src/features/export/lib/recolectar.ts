import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { BUCKET_NINOS_FOTOS } from '@/shared/lib/adjuntos/storage'

import { EXPORT_URL_TTL_SEGUNDOS, type AdjuntoExport } from '../types'

type Client = SupabaseClient<Database>

/** Resultado de recolectar un sujeto: el objeto a exportar + su centro (para el log). */
export interface Recolectado {
  data: Record<string, unknown>
  centroId: string | null
}

function caducaEn(): string {
  return new Date(Date.now() + EXPORT_URL_TTL_SEGUNDOS * 1000).toISOString()
}

/** Firma una ruta de un bucket privado con el TTL largo del export (#4). */
async function firmar(
  service: Client,
  bucket: string,
  path: string,
  descripcion: string
): Promise<AdjuntoExport> {
  const { data } = await service.storage.from(bucket).createSignedUrl(path, EXPORT_URL_TTL_SEGUNDOS)
  return { descripcion, bucket, path, url_firmada: data?.signedUrl ?? null, caduca_en: caducaEn() }
}

/**
 * Recolecta TODOS los datos personales de un USUARIO que el solicitante puede ver
 * (RLS del `client`). Cubre acceso (art. 15); la sección "aportado por ti" marca
 * el subconjunto de portabilidad (art. 20).
 */
export async function recolectarUsuario(
  client: Client,
  usuarioId: string
): Promise<Recolectado | null> {
  const { data: usuario } = await client
    .from('usuarios')
    .select('*')
    .eq('id', usuarioId)
    .maybeSingle()
  if (!usuario) return null // no accesible para el solicitante

  const [roles, consentimientos, vinculos] = await Promise.all([
    client.from('roles_usuario').select('*').eq('usuario_id', usuarioId),
    client.from('consentimientos').select('*').eq('usuario_id', usuarioId),
    client.from('vinculos_familiares').select('*').eq('usuario_id', usuarioId),
  ])

  // Mensajes: hilos donde el sujeto participa (profe↔familia de sus hijos +
  // admin↔familia suyos). Hilo COMPLETO (#2: el personal no es tercero a proteger).
  const ninoIds = (vinculos.data ?? [])
    .filter((v) => v.tipo_vinculo !== 'autorizado')
    .map((v) => v.nino_id)
  const orParts = [`tutor_id.eq.${usuarioId}`]
  if (ninoIds.length > 0) orParts.push(`nino_id.in.(${ninoIds.join(',')})`)
  const { data: convs } = await client.from('conversaciones').select('id').or(orParts.join(','))
  const convIds = (convs ?? []).map((c) => c.id)
  const mensajes = convIds.length
    ? ((await client.from('mensajes').select('*').in('conversacion_id', convIds)).data ?? [])
    : []

  const [ausencias, citasInvitado, recordatorios, firmas] = await Promise.all([
    client.from('ausencias').select('*').eq('reportada_por', usuarioId),
    client.from('cita_invitados').select('*').eq('usuario_id', usuarioId),
    client.from('recordatorios').select('*').eq('usuario_destinatario_id', usuarioId),
    client.from('firmas_autorizacion').select('*').eq('firmante_id', usuarioId),
  ])

  const centroId = (roles.data ?? []).map((r) => r.centro_id)[0] ?? null

  return {
    centroId,
    data: {
      ficha: usuario,
      roles: roles.data ?? [],
      consentimientos: consentimientos.data ?? [],
      vinculos_familiares: vinculos.data ?? [],
      mensajes,
      ausencias_reportadas: ausencias.data ?? [],
      invitaciones_a_citas: citasInvitado.data ?? [],
      recordatorios_recibidos: recordatorios.data ?? [],
      firmas_realizadas: firmas.data ?? [],
      _aportado_por_ti: [
        'ficha (idioma)',
        'consentimientos',
        'mensajes que escribiste',
        'ausencias_reportadas',
        'respuestas a invitaciones_a_citas',
        'firmas_realizadas',
      ],
    },
  }
}

/**
 * Recolecta TODOS los datos personales de un NIÑO que el solicitante puede ver
 * (RLS del `client`). Info médica descifrada vía RPC gateado por permiso (#3);
 * fotos exclusivas con enlace firmado, compartidas solo metadata (#2).
 */
export async function recolectarNino(
  client: Client,
  service: Client,
  ninoId: string
): Promise<Recolectado | null> {
  const { data: nino } = await client.from('ninos').select('*').eq('id', ninoId).maybeSingle()
  if (!nino) return null // no accesible para el solicitante

  // Info médica: descifrado gateado por puede_ver_info_medica (#3).
  let infoMedica: unknown
  const med = await client.rpc('get_info_medica_emergencia', { p_nino_id: ninoId })
  if (med.error) {
    infoMedica = { _nota: 'Existe información médica; no accesible con tu rol/permiso actual.' }
  } else {
    infoMedica = (med.data ?? [])[0] ?? { _nota: 'Sin información médica registrada.' }
  }

  const [
    pedagogicos,
    vinculos,
    agendas,
    asistencias,
    ausencias,
    informes,
    autorizaciones,
    firmas,
    administraciones,
  ] = await Promise.all([
    client.from('datos_pedagogicos_nino').select('*').eq('nino_id', ninoId),
    client.from('vinculos_familiares').select('*').eq('nino_id', ninoId),
    client
      .from('agendas_diarias')
      .select('*, comidas(*), biberones(*), suenos(*), deposiciones(*)')
      .eq('nino_id', ninoId),
    client.from('asistencias').select('*').eq('nino_id', ninoId),
    client.from('ausencias').select('*').eq('nino_id', ninoId),
    client.from('informes_evolucion').select('*').eq('nino_id', ninoId),
    client.from('autorizaciones').select('*').eq('nino_id', ninoId),
    client.from('firmas_autorizacion').select('*').eq('nino_id', ninoId),
    client.from('administraciones_medicacion').select('*').eq('nino_id', ninoId),
  ])

  // Foto de perfil (enlace firmado, #4).
  const adjuntos: AdjuntoExport[] = []
  if (nino.foto_url) {
    adjuntos.push(await firmar(service, BUCKET_NINOS_FOTOS, nino.foto_url, 'Foto de perfil'))
  }

  // Fotos del blog: exclusivas → binario (enlace firmado); compartidas → metadata (#2).
  const fotosCompartidas: Array<Record<string, unknown>> = []
  const { data: etis } = await client
    .from('media_etiquetas')
    .select('media_id')
    .eq('nino_id', ninoId)
  const mediaIds = [...new Set((etis ?? []).map((e) => e.media_id))]
  if (mediaIds.length > 0) {
    const [{ data: todas }, { data: media }] = await Promise.all([
      client.from('media_etiquetas').select('media_id, nino_id').in('media_id', mediaIds),
      client
        .from('media')
        .select('id, bucket, path, publicacion_id, created_at')
        .in('id', mediaIds),
    ])
    const pubIds = [...new Set((media ?? []).map((m) => m.publicacion_id))]
    const { data: pubs } = pubIds.length
      ? await client.from('publicaciones').select('id, texto, created_at').in('id', pubIds)
      : { data: [] }
    const pubDe = (id: string) => (pubs ?? []).find((p) => p.id === id)

    for (const m of media ?? []) {
      const tags = (todas ?? []).filter((t) => t.media_id === m.id)
      const exclusiva = tags.every((t) => t.nino_id === ninoId)
      const pub = pubDe(m.publicacion_id)
      if (exclusiva) {
        adjuntos.push(await firmar(service, m.bucket, m.path, `Foto del blog (${m.created_at})`))
      } else {
        fotosCompartidas.push({
          publicacion_texto: pub?.texto ?? null,
          fecha: pub?.created_at ?? m.created_at,
          aparece_junto_a_otros: tags.length - 1,
          _nota: 'Binario no incluido: la foto muestra a otros menores (PII de terceros).',
        })
      }
    }
  }

  return {
    centroId: nino.centro_id as string,
    data: {
      ficha: nino,
      info_medica_emergencia: infoMedica,
      datos_pedagogicos: pedagogicos.data ?? [],
      vinculos_familiares: vinculos.data ?? [],
      agendas_diarias: agendas.data ?? [],
      asistencias: asistencias.data ?? [],
      ausencias: ausencias.data ?? [],
      informes_evolucion: informes.data ?? [],
      autorizaciones: autorizaciones.data ?? [],
      firmas: firmas.data ?? [],
      administraciones_medicacion: administraciones.data ?? [],
      adjuntos,
      fotos_compartidas: fotosCompartidas,
    },
  }
}
