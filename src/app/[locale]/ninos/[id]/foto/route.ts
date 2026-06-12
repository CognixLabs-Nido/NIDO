import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { FotoInvalidaError } from '@/features/fotos/lib/procesar-foto'
import { MAX_BYTES_ADJUNTO, procesarFotoNino } from '@/shared/lib/adjuntos/procesar-imagen'
import {
  BUCKET_NINOS_FOTOS,
  borrarObjetosBucket,
  firmarRutasBucket,
  rutaThumbDe,
  rutasConThumb,
} from '@/shared/lib/adjuntos/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RespuestaOk {
  success: true
  foto: { path: string; url: string | null; urlMiniatura: string | null }
}
interface RespuestaError {
  success: false
  error: string
}

function err(error: string, status = 400): Response {
  return Response.json({ success: false, error } satisfies RespuestaError, { status })
}

/**
 * Subida + procesado server-side de la **foto del niño** (F10-3, ficha; bucket
 * privado `ninos-fotos`). La sube el **tutor** (su hijo) o **dirección**.
 *
 * Autorización: la **subida va con el cliente del usuario** → la **RLS de
 * `storage.objects`** (F10-0 admin + F10-3 tutor) decide si puede escribir bajo
 * `{centroId}/{ninoId}/...`; un 403 ahí significa "no autorizado" (p. ej. profe, u
 * otro tutor). Solo el `UPDATE` de `ninos.foto_url` (que el tutor no puede hacer por
 * RLS de la tabla) y la firma se hacen con **service role tras autorizar** (ADR-0027).
 * `sharp` quita EXIF/GPS y normaliza a JPEG (perfil + avatar). HEIC se rechaza con
 * mensaje claro (mismo criterio que F10-1).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: ninoId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('fotos.errors.no_autorizado', 401)

  // Ficha visible para el usuario (RLS de `ninos`) → nos da centro_id para la ruta.
  const { data: nino } = await supabase
    .from('ninos')
    .select('id, centro_id, foto_url')
    .eq('id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!nino) return err('fotos.errors.no_autorizado', 403)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return err('fotos.errors.subida_fallo')
  }
  const file = form.get('file')
  if (!(file instanceof Blob)) return err('fotos.errors.subida_fallo')
  if (file.size > MAX_BYTES_ADJUNTO) return err('fotos.validation.tamano_max')

  // 1. Procesado (sharp). Lanza FotoInvalidaError con clave i18n.
  let procesada
  try {
    procesada = await procesarFotoNino(Buffer.from(await file.arrayBuffer()))
  } catch (e) {
    if (e instanceof FotoInvalidaError) return err(e.clave)
    logger.warn('ninos/foto: procesar', e instanceof Error ? e.message : 'desconocido')
    return err('fotos.errors.procesado_fallo', 500)
  }

  const rutas = rutasConThumb(`${nino.centro_id}/${nino.id}`)

  // 2. Subida con el cliente del usuario → la RLS de storage autoriza (admin/tutor).
  const subirOriginal = await supabase.storage
    .from(BUCKET_NINOS_FOTOS)
    .upload(rutas.original, procesada.original, { contentType: 'image/jpeg', upsert: false })
  const subirMini = subirOriginal.error
    ? null
    : await supabase.storage
        .from(BUCKET_NINOS_FOTOS)
        .upload(rutas.miniatura, procesada.miniatura, { contentType: 'image/jpeg', upsert: false })

  if (subirOriginal.error || subirMini?.error) {
    const msg = subirOriginal.error?.message ?? subirMini?.error?.message ?? ''
    // Storage devuelve 403/violación de RLS cuando el usuario no puede escribir.
    if (/row-level security|unauthorized|403/i.test(msg)) {
      await borrarObjetosBucket(supabase, BUCKET_NINOS_FOTOS, [rutas.original]).catch(
        () => undefined
      )
      return err('fotos.errors.no_autorizado', 403)
    }
    logger.warn('ninos/foto: upload', msg)
    return err('fotos.errors.subida_fallo', 500)
  }

  // 3. Service role tras autorizar: actualiza foto_url + limpia la foto anterior.
  const service = await createServiceClient()
  const { error: updErr } = await service
    .from('ninos')
    .update({ foto_url: rutas.original })
    .eq('id', nino.id)
  if (updErr) {
    await borrarObjetosBucket(service, BUCKET_NINOS_FOTOS, [rutas.original, rutas.miniatura]).catch(
      () => undefined
    )
    logger.warn('ninos/foto: update foto_url', updErr.message)
    return err('fotos.errors.subida_fallo', 500)
  }
  if (nino.foto_url && nino.foto_url !== rutas.original) {
    await borrarObjetosBucket(service, BUCKET_NINOS_FOTOS, [
      nino.foto_url,
      rutaThumbDe(nino.foto_url),
    ]).catch(() => undefined)
  }

  const firmadas = await firmarRutasBucket(service, BUCKET_NINOS_FOTOS, [
    rutas.original,
    rutas.miniatura,
  ])
  return Response.json({
    success: true,
    foto: {
      path: rutas.original,
      url: firmadas.get(rutas.original) ?? null,
      urlMiniatura: firmadas.get(rutas.miniatura) ?? null,
    },
  } satisfies RespuestaOk)
}
