import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import {
  BUCKET_DNI_TUTORES,
  BUCKET_LIBRO_FAMILIA,
  BUCKET_NINOS_FOTOS,
  BUCKET_USUARIOS_FOTOS,
  rutaThumbDe,
} from '@/shared/lib/adjuntos/storage'

import { BUCKET_AULA_FOTOS } from '@/features/fotos/types'

import type { SujetoOlvido } from '../types'

type Service = SupabaseClient<Database>

/**
 * Rutas de DNI de `cambios_pendientes` (`datos_tutor_dni`, `payload.path`) que ningún perfil
 * VIVO de `familia_tutores` usa: un DNI ya aplicado es el documento vigente de un tutor y no
 * se borra por esta vía. La carpeta del DNI es la del niño (`{centro}/{nino}/`), donde vive
 * también el del otro tutor: por eso siempre por ruta exacta, nunca por prefijo.
 */
async function dnisPendientesSinUsar(
  service: Service,
  filtro: { nino_id: string } | { solicitado_por: string }
): Promise<string[]> {
  let q = service.from('cambios_pendientes').select('payload').eq('entidad', 'datos_tutor_dni')
  q =
    'nino_id' in filtro
      ? q.eq('nino_id', filtro.nino_id)
      : q.eq('solicitado_por', filtro.solicitado_por)
  const { data, error } = await q
  if (error) throw new Error(`cambios_pendientes (DNI): ${error.message}`)
  const rutas = [
    ...new Set(
      (data ?? [])
        .map((c) => (c.payload as { path?: unknown } | null)?.path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
    ),
  ]
  if (rutas.length === 0) return []
  const { data: vivos, error: vErr } = await service
    .from('familia_tutores')
    .select('dni_documento_path')
    .in('dni_documento_path', rutas)
    .is('deleted_at', null)
  if (vErr) throw new Error(`familia_tutores (DNI): ${vErr.message}`)
  const enUso = new Set((vivos ?? []).map((v) => v.dni_documento_path))
  return rutas.filter((r) => !enUso.has(r))
}

/**
 * Manifiesto DECLARATIVO de fuentes de adjuntos para el barrido del olvido
 * (Decisión C). Cada entrada sabe, para un sujeto, qué rutas de Storage hay que
 * borrar y de qué bucket. El barrido itera el manifiesto sin conocer cada feature.
 *
 * EXTENSIBILIDAD: el futuro anexo de vacunas (datos médicos) se añade como una
 * entrada más `{ bucket, sujetos, recolectar }` — el barrido NO se reescribe.
 *
 * Las firmas (`recogida-adjuntos`, DNIs de terceros) NO entran (#7): son prueba
 * con retención legal; sus adjuntos los purga A6 por tiempo, no el olvido.
 */
export interface FuenteAdjunto {
  /** Identificador legible (logs/tests). */
  nombre: string
  /** Bucket de Storage donde viven los objetos. */
  bucket: string
  /** Tipos de sujeto a los que aplica. */
  sujetos: readonly SujetoOlvido[]
  /** Devuelve las rutas a borrar para ese sujeto (vacío si no hay). */
  recolectar(service: Service, sujetoId: string): Promise<string[]>
}

export const FUENTES_ADJUNTOS: readonly FuenteAdjunto[] = [
  {
    nombre: 'foto-perfil-nino',
    bucket: BUCKET_NINOS_FOTOS,
    sujetos: ['nino'],
    async recolectar(service, ninoId) {
      const { data } = await service.from('ninos').select('foto_url').eq('id', ninoId).maybeSingle()
      const url = data?.foto_url
      return url ? [url, rutaThumbDe(url)] : []
    },
  },
  {
    // Purga RGPD del niño: `purgar_sujeto_db` anula `libro_familia_path`, así que el PDF se
    // borra antes. Por PREFIJO (`{centroId}/{ninoId}/`), no por la ruta vigente: así caen
    // también las subidas anteriores y las que quedaron en cola de validación.
    nombre: 'libro-familia-nino',
    bucket: BUCKET_LIBRO_FAMILIA,
    sujetos: ['nino'],
    async recolectar(service, ninoId) {
      const { data } = await service
        .from('ninos')
        .select('centro_id')
        .eq('id', ninoId)
        .maybeSingle()
      if (!data?.centro_id) return []
      const prefijo = `${data.centro_id}/${ninoId}`
      const { data: objetos } = await service.storage.from(BUCKET_LIBRO_FAMILIA).list(prefijo)
      return (objetos ?? [])
        .filter((o) => o.id !== null) // descarta pseudo-carpetas (id null), solo ficheros
        .map((o) => `${prefijo}/${o.name}`)
    },
  },
  {
    nombre: 'blog-fotos-exclusivas-nino',
    bucket: BUCKET_AULA_FOTOS,
    sujetos: ['nino'],
    async recolectar(service, ninoId) {
      // #5: solo se borra el objeto si el niño era el ÚNICO etiquetado. En fotos
      // compartidas se conserva la foto (dato de terceros); la migración quita solo
      // la etiqueta.
      const { data: etis } = await service
        .from('media_etiquetas')
        .select('media_id')
        .eq('nino_id', ninoId)
      const mediaIds = [...new Set((etis ?? []).map((e) => e.media_id))]
      if (mediaIds.length === 0) return []

      const { data: todas } = await service
        .from('media_etiquetas')
        .select('media_id, nino_id')
        .in('media_id', mediaIds)
      const exclusivos = mediaIds.filter((mid) =>
        (todas ?? []).filter((t) => t.media_id === mid).every((t) => t.nino_id === ninoId)
      )
      if (exclusivos.length === 0) return []

      const { data: media } = await service
        .from('media')
        .select('path, path_miniatura')
        .in('id', exclusivos)
      return (media ?? []).flatMap((m) =>
        [m.path, m.path_miniatura].filter((p): p is string => Boolean(p))
      )
    },
  },
  {
    // Cierre de la purga: el DNI de un tutor que se quedó en un cambio pendiente del niño (sin
    // aplicar). `purgar_sujeto_db` borra esos cambios; el documento se borra antes.
    nombre: 'dni-cambios-pendientes-nino',
    bucket: BUCKET_DNI_TUTORES,
    sujetos: ['nino'],
    recolectar: (service, ninoId) => dnisPendientesSinUsar(service, { nino_id: ninoId }),
  },
  {
    // Cierre de la purga: la foto de perfil del usuario. Su carpeta `{centro}/{usuario}/` es
    // solo suya (una cuenta = un centro), así que va por prefijo: caen también las anteriores.
    nombre: 'avatar-usuario',
    bucket: BUCKET_USUARIOS_FOTOS,
    sujetos: ['usuario'],
    async recolectar(service, usuarioId) {
      const [{ data: u, error: uErr }, { data: roles, error: rErr }] = await Promise.all([
        service.from('usuarios').select('foto_url').eq('id', usuarioId).maybeSingle(),
        service.from('roles_usuario').select('centro_id').eq('usuario_id', usuarioId),
      ])
      if (uErr) throw new Error(`usuarios (avatar): ${uErr.message}`)
      if (rErr) throw new Error(`roles_usuario (avatar): ${rErr.message}`)
      const rutas = new Set<string>()
      if (u?.foto_url) {
        rutas.add(u.foto_url)
        rutas.add(rutaThumbDe(u.foto_url))
      }
      for (const centro of new Set((roles ?? []).map((r) => r.centro_id))) {
        const prefijo = `${centro}/${usuarioId}`
        const { data: objetos } = await service.storage.from(BUCKET_USUARIOS_FOTOS).list(prefijo)
        for (const o of objetos ?? []) if (o.id !== null) rutas.add(`${prefijo}/${o.name}`)
      }
      return [...rutas]
    },
  },
  {
    // Cierre de la purga: su DNI de tutor (`familia_tutores.dni_documento_path`), por ruta
    // exacta, y los que dejó en cambios pendientes sin aplicar.
    nombre: 'dni-tutor',
    bucket: BUCKET_DNI_TUTORES,
    sujetos: ['usuario'],
    async recolectar(service, usuarioId) {
      const { data, error } = await service
        .from('familia_tutores')
        .select('dni_documento_path')
        .eq('usuario_id', usuarioId)
      if (error) throw new Error(`familia_tutores (DNI): ${error.message}`)
      const propios = (data ?? [])
        .map((f) => f.dni_documento_path)
        .filter((p): p is string => Boolean(p))
      const pendientes = await dnisPendientesSinUsar(service, { solicitado_por: usuarioId })
      return [...new Set([...propios, ...pendientes])]
    },
  },
]

/**
 * Recorre el manifiesto y agrupa por bucket las rutas a borrar para un sujeto.
 * Se invoca ANTES de la purga SQL (que anula `foto_url` / borra filas `media`),
 * de modo que las rutas siguen siendo resolubles.
 */
export async function recolectarAdjuntosDe(
  service: Service,
  sujetoTipo: SujetoOlvido,
  sujetoId: string
): Promise<Map<string, string[]>> {
  const porBucket = new Map<string, string[]>()
  for (const fuente of FUENTES_ADJUNTOS) {
    if (!fuente.sujetos.includes(sujetoTipo)) continue
    const paths = await fuente.recolectar(service, sujetoId)
    if (paths.length === 0) continue
    porBucket.set(fuente.bucket, [...(porBucket.get(fuente.bucket) ?? []), ...paths])
  }
  return porBucket
}
