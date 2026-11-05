import 'server-only'

import { createHash } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { usuarioResponsableEn } from '@/features/centros/contexto/roles-del-usuario'
import { BUCKET_DOCUMENTOS_CENTRO, borrarObjetosBucket } from '@/shared/lib/adjuntos/storage'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

/** Tope en la app; el bucket también lo exige (10 MB). */
export const MAX_PDF_BYTES = 10 * 1024 * 1024

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

const E = 'documentos_centro.errors'

/** Un PDF empieza por `%PDF-`: el tipo que dice el navegador no basta. */
export function esPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-'
}

/** El sha256 de los bytes, en hexadecimal: el nombre del fichero y la huella de la versión. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** La ruta del fichero de una versión. La misma expresión que el CHECK de la tabla. */
export function rutaVersion(centroId: string, documentoId: string, sha256: string): string {
  return `${centroId}/${documentoId}/${sha256}.pdf`
}

/** El objeto ya existe en la ruta: Storage contesta 409 («Duplicate» / «already exists»). */
function esYaExiste(error: { message?: string; statusCode?: string; status?: number }): boolean {
  return (
    error.status === 409 ||
    error.statusCode === '409' ||
    /already exists|duplicate/i.test(error.message ?? '')
  )
}

/** La clave del error de la base, por su HINT (las funciones de 20270101120000). */
function errorDeLaBase(e: { code?: string; hint?: string | null }): string {
  if (e.code === '42501') return `${E}.no_autorizado`
  switch (e.hint) {
    case 'ya_subida':
    case 'retirado':
    case 'falta_curso':
    case 'sobra_curso':
    case 'curso_cerrado':
    case 'curso_ajeno':
      return `${E}.${e.hint}`
    case 'sin_fichero':
    case 'fichero_distinto':
      return `${E}.subida`
    default:
      return `${E}.guardar`
  }
}

/**
 * Sube una versión de un documento del centro (1a, `20270101120000`). Solo la admin del centro (J1):
 * se comprueba con su sesión antes de tocar Storage, y la base lo vuelve a mirar al registrar.
 *
 * El hash lo calcula el servidor con los bytes que sube, y el fichero se llama por él: lo que se
 * registra es lo que se subió. La subida va con el servicio (el bucket no tiene políticas) y sin
 * sobrescribir; si el fichero ya estaba (una subida anterior que no llegó a registrarse), es el mismo
 * contenido, porque la ruta es su hash, y se registra igual. Si el registro falla, se borra lo que
 * se acaba de subir.
 */
export async function subirVersionDocumento(
  sesion: Client,
  service: Client,
  input: { centroId: string; documentoId: string; cursoId: string | null; bytes: Uint8Array }
): Promise<Resultado<{ versionId: string; sha256: string }>> {
  if (!(await usuarioResponsableEn(sesion, input.centroId)))
    return { ok: false, error: `${E}.no_autorizado` }
  if (input.bytes.length === 0 || input.bytes.length > MAX_PDF_BYTES)
    return { ok: false, error: `${E}.tamano` }
  if (!esPdf(input.bytes)) return { ok: false, error: `${E}.tipo_pdf` }

  const sha256 = sha256Hex(input.bytes)
  const ruta = rutaVersion(input.centroId, input.documentoId, sha256)
  const subida = await service.storage
    .from(BUCKET_DOCUMENTOS_CENTRO)
    .upload(ruta, input.bytes, { contentType: 'application/pdf', upsert: false })
  const yaEstaba = subida.error ? esYaExiste(subida.error) : false
  if (subida.error && !yaEstaba) {
    logger.warn('documentos del centro: subida', subida.error.message)
    return { ok: false, error: `${E}.subida` }
  }

  const { data, error } = await sesion.rpc('registrar_version_documento', {
    p_documento_id: input.documentoId,
    p_curso_academico_id: input.cursoId,
    p_sha256: sha256,
    p_bytes: input.bytes.length,
  })
  if (error || !data) {
    // Lo que se acaba de subir y no quedó registrado no se deja suelto. Si ya estaba, no es nuestro.
    if (!yaEstaba)
      await borrarObjetosBucket(service, BUCKET_DOCUMENTOS_CENTRO, [ruta]).catch(() => undefined)
    if (!error) return { ok: false, error: `${E}.guardar` }
    if (errorDeLaBase(error) === `${E}.guardar`)
      logger.warn('documentos del centro: registrar', error.message)
    return { ok: false, error: errorDeLaBase(error) }
  }
  return { ok: true, data: { versionId: data, sha256 } }
}

/**
 * Borra una versión sin firmas (J5): la base borra la fila y deja quién lo hizo, y después se borra su
 * fichero. Si el fichero no se va, la versión ya no existe y el fichero queda suelto: se dice, y la
 * lista de la admin lo enseña para reintentarlo (`borrarFicheroSuelto`). Un PDF subido por error puede
 * llevar datos de otra familia: no se deja sin decirlo.
 */
export async function borrarVersionDocumento(
  sesion: Client,
  service: Client,
  versionId: string
): Promise<Resultado<{ ficheroBorrado: boolean }>> {
  const { data: ruta, error } = await sesion.rpc('borrar_version_documento', {
    p_version_id: versionId,
  })
  if (error || !ruta) {
    if (error && errorDeLaBase(error) === `${E}.guardar`)
      logger.warn('documentos del centro: borrar', error.message)
    return { ok: false, error: error ? errorDeLaBase(error) : `${E}.guardar` }
  }
  return { ok: true, data: { ficheroBorrado: await quitarFichero(service, ruta) } }
}

/** Reintenta borrar un fichero que ya no es de ninguna versión, si es del centro de la admin. */
export async function borrarFicheroSuelto(
  sesion: Client,
  service: Client,
  centroId: string,
  ruta: string
): Promise<Resultado<{ ficheroBorrado: boolean }>> {
  const { data, error } = await sesion.rpc('documentos_centro_admin', { p_centro_id: centroId })
  if (error) return { ok: false, error: errorDeLaBase(error) }
  const sueltos = ((data as { ficheros_sueltos?: string[] } | null)?.ficheros_sueltos ??
    []) as string[]
  if (!sueltos.includes(ruta)) return { ok: false, error: `${E}.no_suelto` }
  return { ok: true, data: { ficheroBorrado: await quitarFichero(service, ruta) } }
}

async function quitarFichero(service: Client, ruta: string): Promise<boolean> {
  const { data, error } = await service.storage.from(BUCKET_DOCUMENTOS_CENTRO).remove([ruta])
  if (error || (data ?? []).length === 0) {
    logger.error('documentos del centro: el fichero no se borró', error?.message ?? 'sin filas')
    return false
  }
  return true
}
