import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { rolesDelSujetoParaExport } from '@/features/centros/contexto/roles-de-otros'
import { fichaMedicaBloqueadaDesde } from '@/features/ninos/lib/ficha-medica-bloqueada'

import {
  BUCKET_DNI_TUTORES,
  BUCKET_MANDATO_SEPA,
  BUCKET_NINOS_FOTOS,
} from '@/shared/lib/adjuntos/storage'

import { EXPORT_URL_TTL_SEGUNDOS, type AdjuntoExport } from '../types'

import { columnasDe, type FilaDe, type RutaRecolectar } from './columnas-recolectar'

type Client = SupabaseClient<Database>

/** Resultado de recolectar un sujeto: el objeto a exportar + su centro (para el log). */
export interface Recolectado {
  data: Record<string, unknown>
  centroId: string | null
}

function caducaEn(): string {
  return new Date(Date.now() + EXPORT_URL_TTL_SEGUNDOS * 1000).toISOString()
}

/** Opciones del export que dependen de la ruta, no de quien lo pide. */
export interface OpcionesRecolectar {
  /**
   * `matriculas.motivo_baja` (notas internas de Dirección): solo en el export de Dirección
   * (`/export/[tipo]/[id]`), nunca en `/export/me`. Aun pedido, solo sale si quien exporta es
   * admin del centro: `get_motivos_baja_matriculas` da 42501 a cualquier otro.
   */
  incluirMotivoBaja?: boolean
}

type Fila = Record<string, unknown>

/**
 * Lo que el export añade sobre lo que la sesión ya lee: `export_datos_sujeto`
 * (`20261014120000`). El control de acceso vive en la función: el propio usuario, un tutor
 * legal del niño o el admin de su centro. Cualquier otro (la profe, el autorizado) recibe
 * 42501, que aquí es una AUSENCIA legítima (`null`); cualquier otro error es un fallo y
 * rompe el export, que no puede salir incompleto sin decirlo.
 */
async function datosSujeto(
  client: Client,
  tipo: 'usuario' | 'nino',
  id: string
): Promise<Fila | null> {
  const { data, error } = await client.rpc('export_datos_sujeto', {
    p_sujeto_tipo: tipo,
    p_sujeto_id: id,
  })
  if (error) {
    if (error.code === '42501') return null
    throw new Error(`export_datos_sujeto falló: ${error.message}`)
  }
  return (data ?? {}) as Fila
}

const NOTA_SIN_DATOS_AMPLIADOS =
  'Los datos administrativos, de admisión y de cobros solo los exportan la persona interesada, sus tutores legales y la Dirección del centro.'

function filas(v: unknown): Fila[] {
  return Array.isArray(v) ? (v as Fila[]) : []
}

interface Lectura {
  data: unknown
  error: { message: string } | null
}

/**
 * El resultado de una lectura del export. Un fallo rompe el export, que no puede salir incompleto
 * sin decirlo: con las columnas pedidas una a una (`columnasDe`), una columna que ya no está en la
 * base da error, y antes ese error salía como una sección vacía. Lo que la RLS no deja ver no es un
 * fallo: llega como 0 filas, sin error.
 */
function leido<T>(que: string, r: Lectura): T[] {
  if (r.error) throw new Error(`export: la lectura de ${que} falló: ${r.error.message}`)
  return (r.data ?? []) as T[]
}

/** Las filas de una sección del catálogo: solo sus columnas que salen, que son las que se piden. */
function filasDe<R extends RutaRecolectar>(ruta: R, r: Lectura): FilaDe<R>[] {
  return leido<FilaDe<R>>(ruta, r)
}

/** La fila del sujeto (`maybeSingle`): null si no existe o la RLS no la deja ver. */
function filaDe<R extends RutaRecolectar>(ruta: R, r: Lectura): FilaDe<R> | null {
  if (r.error) throw new Error(`export: la lectura de ${ruta} falló: ${r.error.message}`)
  return (r.data ?? null) as FilaDe<R> | null
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
  service: Client,
  usuarioId: string
): Promise<Recolectado | null> {
  const usuario = filaDe(
    'usuario.ficha',
    await client
      .from('usuarios')
      .select(columnasDe('usuario.ficha'))
      .eq('id', usuarioId)
      .maybeSingle()
  )
  if (!usuario) return null // no accesible para el solicitante

  const [roles, consentimientos, vinculos] = await Promise.all([
    rolesDelSujetoParaExport(client, usuarioId),
    // entre-centros: el export del sujeto (art. 15), con lo que alcanza la sesión de quien exporta.
    client
      .from('consentimientos')
      .select(columnasDe('usuario.consentimientos'))
      .eq('usuario_id', usuarioId)
      .then((r) => filasDe('usuario.consentimientos', r)),
    // entre-centros: el export del sujeto (art. 15), con lo que alcanza la sesión de quien exporta.
    client
      .from('vinculos_familiares')
      .select(columnasDe('usuario.vinculos_familiares'))
      .eq('usuario_id', usuarioId)
      .then((r) => filasDe('usuario.vinculos_familiares', r)),
  ])

  // Mensajes: hilos donde el sujeto participa (profe↔familia de sus hijos +
  // admin↔familia suyos). Hilo COMPLETO (#2: el personal no es tercero a proteger).
  const ninoIds = vinculos.filter((v) => v.tipo_vinculo !== 'autorizado').map((v) => v.nino_id)
  const orParts = [`tutor_id.eq.${usuarioId}`]
  if (ninoIds.length > 0) orParts.push(`nino_id.in.(${ninoIds.join(',')})`)
  // entre-centros: el export del sujeto (art. 15), con lo que alcanza la sesión de quien exporta.
  const convs = leido<{ id: string }>(
    'conversaciones',
    await client.from('conversaciones').select('id').or(orParts.join(','))
  )
  const convIds = convs.map((c) => c.id)
  const mensajes = convIds.length
    ? filasDe(
        'usuario.mensajes',
        await client
          .from('mensajes')
          .select(columnasDe('usuario.mensajes'))
          .in('conversacion_id', convIds)
      )
    : []

  const [ausencias, citasInvitado, recordatorios, firmas] = await Promise.all([
    // entre-centros: el export del sujeto (art. 15), con lo que alcanza la sesión de quien exporta.
    client
      .from('ausencias')
      .select(columnasDe('usuario.ausencias_reportadas'))
      .eq('reportada_por', usuarioId)
      .then((r) => filasDe('usuario.ausencias_reportadas', r)),
    // entre-centros: el export del sujeto (art. 15), con lo que alcanza la sesión de quien exporta.
    client
      .from('cita_invitados')
      .select(columnasDe('usuario.invitaciones_a_citas'))
      .eq('usuario_id', usuarioId)
      .then((r) => filasDe('usuario.invitaciones_a_citas', r)),
    // entre-centros: el export del sujeto (art. 15), con lo que alcanza la sesión de quien exporta.
    client
      .from('recordatorios')
      .select(columnasDe('usuario.recordatorios_recibidos'))
      .eq('usuario_destinatario_id', usuarioId)
      .then((r) => filasDe('usuario.recordatorios_recibidos', r)),
    // entre-centros: el export del sujeto (art. 15), con lo que alcanza la sesión de quien exporta.
    client
      .from('firmas_autorizacion')
      .select(columnasDe('usuario.firmas_realizadas'))
      .eq('firmante_id', usuarioId)
      .then((r) => filasDe('usuario.firmas_realizadas', r)),
  ])

  const centroId = roles.map((r) => r.centro_id)[0] ?? null

  // Lo que la sesión no alcanza (perfil de familia, cobros, lista de espera, dispositivos…).
  const extra = await datosSujeto(client, 'usuario', usuarioId)
  if (extra) anotarBloqueados(extra)

  // DNI y mandato firmado: enlace firmado, como las fotos (#4).
  const adjuntos: AdjuntoExport[] = []
  for (const p of filas(extra?.perfiles_familia)) {
    if (typeof p.dni_documento_path === 'string' && p.dni_documento_path) {
      adjuntos.push(await firmar(service, BUCKET_DNI_TUTORES, p.dni_documento_path, 'DNI'))
    }
  }
  for (const m of filas(extra?.mandatos_sepa)) {
    if (typeof m.documento_path === 'string' && m.documento_path) {
      adjuntos.push(
        await firmar(service, BUCKET_MANDATO_SEPA, m.documento_path, 'Mandato SEPA firmado')
      )
    }
  }

  return {
    centroId,
    data: {
      ficha: usuario,
      roles,
      consentimientos,
      vinculos_familiares: vinculos,
      mensajes,
      ausencias_reportadas: ausencias,
      invitaciones_a_citas: citasInvitado,
      recordatorios_recibidos: recordatorios,
      firmas_realizadas: firmas,
      ...(extra ?? { datos_ampliados: { _nota: NOTA_SIN_DATOS_AMPLIADOS } }),
      adjuntos,
      _aportado_por_ti: [
        'ficha (idioma)',
        'consentimientos',
        'mensajes que escribiste',
        'ausencias_reportadas',
        'respuestas a invitaciones_a_citas',
        'firmas_realizadas',
        'preferencias',
        'perfiles_familia',
        'mandatos_sepa',
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
  ninoId: string,
  opciones: OpcionesRecolectar = {}
): Promise<Recolectado | null> {
  const nino = filaDe(
    'nino.ficha',
    await client.from('ninos').select(columnasDe('nino.ficha')).eq('id', ninoId).maybeSingle()
  )
  if (!nino) return null // no accesible para el solicitante

  // Info médica: descifrado gateado por puede_ver_info_medica (#3).
  let infoMedica: unknown
  const med = await client.rpc('get_info_medica_emergencia', {
    p_nino_id: ninoId,
    p_origen: 'export',
  })
  const bloqueadaDesde = fichaMedicaBloqueadaDesde(med.error)
  if (bloqueadaDesde) {
    infoMedica = fichaMedicaBloqueadaEnExport(bloqueadaDesde, nino.deleted_reason === 'purga_rgpd')
  } else if (med.error) {
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
    client
      .from('datos_pedagogicos_nino')
      .select(columnasDe('nino.datos_pedagogicos'))
      .eq('nino_id', ninoId)
      .then((r) => filasDe('nino.datos_pedagogicos', r)),
    client
      .from('vinculos_familiares')
      .select(columnasDe('nino.vinculos_familiares'))
      .eq('nino_id', ninoId)
      .then((r) => filasDe('nino.vinculos_familiares', r)),
    client
      .from('agendas_diarias')
      .select(
        `${columnasDe('nino.agendas_diarias')}, ` +
          `comidas(${columnasDe('nino.agendas_diarias.comidas')}), ` +
          `biberones(${columnasDe('nino.agendas_diarias.biberones')}), ` +
          `suenos(${columnasDe('nino.agendas_diarias.suenos')}), ` +
          `deposiciones(${columnasDe('nino.agendas_diarias.deposiciones')})`
      )
      .eq('nino_id', ninoId)
      .then((r) => filasDe('nino.agendas_diarias', r)),
    client
      .from('asistencias')
      .select(columnasDe('nino.asistencias'))
      .eq('nino_id', ninoId)
      .then((r) => filasDe('nino.asistencias', r)),
    client
      .from('ausencias')
      .select(columnasDe('nino.ausencias'))
      .eq('nino_id', ninoId)
      .then((r) => filasDe('nino.ausencias', r)),
    client
      .from('informes_evolucion')
      .select(columnasDe('nino.informes_evolucion'))
      .eq('nino_id', ninoId)
      .then((r) => filasDe('nino.informes_evolucion', r)),
    client
      .from('autorizaciones')
      .select(columnasDe('nino.autorizaciones'))
      .eq('nino_id', ninoId)
      .then((r) => filasDe('nino.autorizaciones', r)),
    client
      .from('firmas_autorizacion')
      .select(columnasDe('nino.firmas'))
      .eq('nino_id', ninoId)
      .then((r) => filasDe('nino.firmas', r)),
    client
      .from('administraciones_medicacion')
      .select(columnasDe('nino.administraciones_medicacion'))
      .eq('nino_id', ninoId)
      .then((r) => filasDe('nino.administraciones_medicacion', r)),
  ])

  // Foto de perfil (enlace firmado, #4).
  const adjuntos: AdjuntoExport[] = []
  if (nino.foto_url) {
    adjuntos.push(await firmar(service, BUCKET_NINOS_FOTOS, nino.foto_url, 'Foto de perfil'))
  }

  // Fotos del blog: exclusivas → binario (enlace firmado); compartidas → metadata (#2).
  const fotosCompartidas: Array<Record<string, unknown>> = []
  const etis = leido<{ media_id: string }>(
    'media_etiquetas',
    await client.from('media_etiquetas').select('media_id').eq('nino_id', ninoId)
  )
  const mediaIds = [...new Set(etis.map((e) => e.media_id))]
  if (mediaIds.length > 0) {
    const [todas, media] = await Promise.all([
      client
        .from('media_etiquetas')
        .select('media_id, nino_id')
        .in('media_id', mediaIds)
        .then((r) => leido<{ media_id: string; nino_id: string }>('media_etiquetas', r)),
      client
        .from('media')
        .select('id, bucket, path, publicacion_id, created_at')
        .in('id', mediaIds)
        .then((r) =>
          leido<{
            id: string
            bucket: string
            path: string
            publicacion_id: string
            created_at: string
          }>('media', r)
        ),
    ])
    const pubIds = [...new Set(media.map((m) => m.publicacion_id))]
    const pubs = pubIds.length
      ? leido<{ id: string; texto: string | null; created_at: string }>(
          'publicaciones',
          await client.from('publicaciones').select('id, texto, created_at').in('id', pubIds)
        )
      : []
    const pubDe = (id: string) => pubs.find((p) => p.id === id)

    for (const m of media) {
      const tags = todas.filter((t) => t.media_id === m.id)
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

  // Lo que la sesión no alcanza (lista de espera, matrículas, consentimientos, cobros…).
  const extra = await datosSujeto(client, 'nino', ninoId)
  if (extra) anotarBloqueados(extra)

  if (extra && opciones.incluirMotivoBaja) {
    const motivos = await client.rpc('get_motivos_baja_matriculas', { p_nino_ids: [ninoId] })
    if (motivos.error && motivos.error.code !== '42501') {
      throw new Error(`get_motivos_baja_matriculas falló: ${motivos.error.message}`)
    }
    const porMatricula = new Map(
      (motivos.data ?? []).map((m) => [m.matricula_id, m.motivo_baja] as const)
    )
    extra.matriculas = filas(extra.matriculas).map((m) =>
      porMatricula.has(m.id as string) ? { ...m, motivo_baja: porMatricula.get(m.id as string) } : m
    )
  }

  return {
    centroId: nino.centro_id as string,
    data: {
      ficha: nino,
      info_medica_emergencia: infoMedica,
      datos_pedagogicos: pedagogicos,
      vinculos_familiares: vinculos,
      agendas_diarias: agendas,
      asistencias,
      ausencias,
      informes_evolucion: informes,
      autorizaciones,
      firmas,
      administraciones_medicacion: administraciones,
      adjuntos,
      fotos_compartidas: fotosCompartidas,
      ...(extra ?? { datos_ampliados: { _nota: NOTA_SIN_DATOS_AMPLIADOS } }),
    },
  }
}

/**
 * La ficha médica bloqueada al terminar el curso de la baja (20261204120000) no sale en el export:
 * lo bloqueado solo se entrega a un juez, a la Administración o para una reclamación (art. 32
 * LOPDGDD). Pero no se omite en silencio: el art. 15 da derecho a saber qué datos se tratan, así
 * que se dice que existe, que está bloqueada, desde cuándo, por qué y cómo pedirla. Exportada para
 * su test.
 *
 * Con el niño purgado (20261210120000) la ficha se vació con la purga y queda bloqueada desde ese
 * día: no hay nada que pedir, y decir que «se conserva» sería falso.
 */
export function fichaMedicaBloqueadaEnExport(
  desde: string,
  purgado = false
): Record<string, string> {
  const [a, m, d] = desde.split('-')
  if (purgado) {
    return {
      _nota:
        `La información médica del niño se borró el ${d}/${m}/${a}, con la purga de sus datos. ` +
        'No queda nada que entregar.',
      bloqueada_desde: desde,
    }
  }
  return {
    _nota:
      `Existe información médica del niño y está BLOQUEADA desde el ${d}/${m}/${a}, porque terminó ` +
      'el curso en que causó baja. Se conserva sin uso hasta que se borre su expediente, por si ' +
      'hiciera falta ante una reclamación, y durante el bloqueo no se entrega en esta exportación: ' +
      'solo puede facilitarse a jueces y tribunales, al Ministerio Fiscal o a las administraciones ' +
      'competentes, en particular a la autoridad de protección de datos (art. 32 LOPDGDD). Si la ' +
      'necesitas para una reclamación, pídela por escrito a la dirección del centro.',
    bloqueada_desde: desde,
  }
}

/**
 * Lo que se conserva por obligación legal y está bloqueado tras la purga (20261205120000), con la
 * etiqueta de cada código de `privado.datos_bloqueados`. Un test comprueba que cubre los de la
 * migración; uno que faltara saldría con su código, nunca callado. Lo fiscal (recibos, mandatos,
 * parte de servicio, conceptos, becas) no se bloquea: sale en el export como siempre.
 */
export const DATOS_BLOQUEADOS: Record<string, string> = {
  firmas: 'firmas de autorizaciones',
  autorizaciones: 'autorizaciones',
  consentimientos: 'consentimientos',
  acuses_alta: 'acuses del alta',
  medicacion_administrada: 'medicación administrada',
  lecturas_ficha_medica: 'registro de consultas de la ficha médica',
}

/**
 * Por qué la titular vio lo bloqueado (`accesos_datos_bloqueados.motivo_tipo`). El sujeto sabe el
 * tipo y la fecha, no el texto del motivo ni quién (decidido por el responsable, 2026-10-29).
 */
export const MOTIVOS_ACCESO: Record<string, string> = {
  agencia_tributaria: 'un requerimiento de la Agencia Tributaria',
  juzgado: 'un requerimiento judicial',
  reclamacion: 'una reclamación',
  proteccion_datos: 'un requerimiento de la autoridad de protección de datos',
  otro: 'otro motivo',
}

function fechaEs(desde: string): string {
  const [a, m, d] = desde.split('-')
  return `${d}/${m}/${a}`
}

/**
 * Lo bloqueado no sale en el export: solo se entrega a un juez, a la Administración o para una
 * reclamación (art. 32 LOPDGDD). Pero no se calla: el art. 15 da derecho a saber qué datos se
 * tratan, así que se dice qué hay, cuánto, desde cuándo, por qué y cómo pedirlo, y cuántas veces
 * lo ha consultado el centro, por qué tipo de motivo y cuándo. NULL si no hay nada que decir.
 * Exportada para su test.
 */
export function datosBloqueadosEnExport(
  v: unknown,
  consultas?: unknown
): Record<string, string> | null {
  const items = filas(v).filter((x) => typeof x.codigo === 'string' && typeof x.n === 'number')
  const vistas = filas(consultas).filter(
    (x) => typeof x.motivo_tipo === 'string' && typeof x.fecha === 'string'
  )
  if (items.length === 0 && vistas.length === 0) return null
  const lista = items
    .map((x) => {
      const etiqueta = DATOS_BLOQUEADOS[x.codigo as string] ?? (x.codigo as string)
      const desde = typeof x.desde === 'string' ? `, desde el ${fechaEs(x.desde)}` : ''
      return `${etiqueta} (${x.n}${desde})`
    })
    .join('; ')
  const fechas = items
    .map((x) => x.desde)
    .filter((d): d is string => typeof d === 'string')
    .sort()
  const consultado = vistas.length
    ? ` El centro los ha consultado ${vistas.length} ${vistas.length === 1 ? 'vez' : 'veces'}: ` +
      vistas
        .map(
          (x) =>
            `por ${MOTIVOS_ACCESO[x.motivo_tipo as string] ?? (x.motivo_tipo as string)}, ` +
            `el ${fechaEs(x.fecha as string)}`
        )
        .join('; ') +
      '.'
    : ''
  return {
    _nota:
      (lista ? `Hay datos que el centro conserva BLOQUEADOS: ${lista}. ` : '') +
      'Se borró el resto de datos, y la ley obliga a guardar estos durante un plazo (por ejemplo, ' +
      'las firmas de las autorizaciones). Mientras dura el bloqueo no se usan ni se entregan en ' +
      'esta exportación: solo pueden facilitarse a jueces y tribunales, al Ministerio Fiscal o a ' +
      'las administraciones competentes, en particular a la autoridad de protección de datos ' +
      '(art. 32 LOPDGDD). Si los necesitas para una reclamación, pídelos por escrito a la ' +
      'dirección del centro.' +
      consultado,
    ...(fechas[0] ? { bloqueados_desde: fechas[0] } : {}),
  }
}

/**
 * Cambia la lista de `export_datos_sujeto` (y sus consultas) por su nota, o la quita si no hay
 * nada que decir.
 */
function anotarBloqueados(extra: Fila): void {
  const nota = datosBloqueadosEnExport(extra.datos_bloqueados, extra.consultas_datos_bloqueados)
  delete extra.consultas_datos_bloqueados
  if (nota) extra.datos_bloqueados = nota
  else delete extra.datos_bloqueados
}
