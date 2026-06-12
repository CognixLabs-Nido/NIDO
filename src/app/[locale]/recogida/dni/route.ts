import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { FotoInvalidaError } from '@/features/fotos/lib/procesar-foto'
import { MAX_BYTES_ADJUNTO, procesarDocumento } from '@/shared/lib/adjuntos/procesar-imagen'
import {
  BUCKET_RECOGIDA_ADJUNTOS,
  borrarObjetosBucket,
  firmarRutasBucket,
  rutasConThumb,
} from '@/shared/lib/adjuntos/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RespuestaOk {
  success: true
  adjunto: {
    bucket: string
    path: string
    hash: string
    url: string | null
    urlMiniatura: string | null
  }
}
interface RespuestaError {
  success: false
  error: string
}

function err(error: string, status = 400): Response {
  return Response.json({ success: false, error } satisfies RespuestaError, { status })
}

/**
 * Subida + procesado de la **foto del DNI** de una persona autorizada a recoger
 * (F10-3; bucket privado `recogida-adjuntos`). La sube el **tutor** ANTES de firmar
 * la recogida; el cliente guarda `{ bucket, path, hash }` y, al firmar, se pliega a
 * `firmas.datos.adjuntos` y al **hash compuesto** (queda atado a la firma).
 *
 * Ruta `{centroId}/{ninoId}/...`: la **RLS de `storage.objects`** (F10-3
 * `recogida_adjuntos_insert_tutor` = `es_tutor_de(ninoId)`) autoriza la subida con el
 * cliente del usuario; aislamiento entre familias. Es un **documento legible** → se
 * comprime poco (solo se quita EXIF/GPS). HEIC se rechaza con mensaje claro.
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('autorizaciones.errors.no_autorizado', 401)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return err('fotos.errors.subida_fallo')
  }
  const file = form.get('file')
  const ninoId = form.get('nino_id')
  if (!(file instanceof Blob) || typeof ninoId !== 'string') return err('fotos.errors.subida_fallo')
  if (file.size > MAX_BYTES_ADJUNTO) return err('fotos.validation.tamano_max')

  // Ficha del niño (RLS: el tutor la ve) → centro_id para la ruta.
  const { data: nino } = await supabase
    .from('ninos')
    .select('id, centro_id')
    .eq('id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!nino) return err('autorizaciones.errors.no_es_tutor', 403)

  // 1. Procesado (sharp). Lanza FotoInvalidaError con clave i18n.
  let procesada
  try {
    procesada = await procesarDocumento(Buffer.from(await file.arrayBuffer()))
  } catch (e) {
    if (e instanceof FotoInvalidaError) return err(e.clave)
    logger.warn('recogida/dni: procesar', e instanceof Error ? e.message : 'desconocido')
    return err('fotos.errors.procesado_fallo', 500)
  }

  const rutas = rutasConThumb(`${nino.centro_id}/${nino.id}`)

  // 2. Subida con el cliente del usuario → la RLS de storage autoriza (solo tutor).
  const subirOriginal = await supabase.storage
    .from(BUCKET_RECOGIDA_ADJUNTOS)
    .upload(rutas.original, procesada.original, { contentType: 'image/jpeg', upsert: false })
  const subirMini = subirOriginal.error
    ? null
    : await supabase.storage
        .from(BUCKET_RECOGIDA_ADJUNTOS)
        .upload(rutas.miniatura, procesada.miniatura, { contentType: 'image/jpeg', upsert: false })

  if (subirOriginal.error || subirMini?.error) {
    const msg = subirOriginal.error?.message ?? subirMini?.error?.message ?? ''
    if (/row-level security|unauthorized|403/i.test(msg)) {
      await borrarObjetosBucket(supabase, BUCKET_RECOGIDA_ADJUNTOS, [rutas.original]).catch(
        () => undefined
      )
      return err('autorizaciones.errors.no_es_tutor', 403)
    }
    logger.warn('recogida/dni: upload', msg)
    return err('fotos.errors.subida_fallo', 500)
  }

  const firmadas = await firmarRutasBucket(supabase, BUCKET_RECOGIDA_ADJUNTOS, [
    rutas.original,
    rutas.miniatura,
  ])
  return Response.json({
    success: true,
    adjunto: {
      bucket: BUCKET_RECOGIDA_ADJUNTOS,
      path: rutas.original,
      hash: procesada.hash,
      url: firmadas.get(rutas.original) ?? null,
      urlMiniatura: firmadas.get(rutas.miniatura) ?? null,
    },
  } satisfies RespuestaOk)
}
