import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { FotoInvalidaError, procesarFoto } from '@/features/fotos/lib/procesar-foto'
import { firmarRutas, prefijoPublicacion, rutasFotoNueva } from '@/features/fotos/lib/storage'
import { subirFotoSchema } from '@/features/fotos/schemas/publicaciones'
import {
  BUCKET_AULA_FOTOS,
  MAX_BYTES_FOTO,
  MAX_FOTOS_PUBLICACION,
  MIME_FOTO_SALIDA,
} from '@/features/fotos/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RespuestaOk {
  success: true
  media: {
    id: string
    ancho: number | null
    alto: number | null
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
 * Subida + procesado server-side de UNA foto de una publicación (F10-1).
 *
 * Excepción legítima a "Server Actions, no API routes" (binario, como el PDF de
 * F9-4): recibe `multipart/form-data` con `publicacion_id` + `file`, procesa con
 * `sharp` (EXIF/GPS fuera, original + miniatura JPEG) y persiste. Solo JPG/PNG: el
 * HEIC se rechaza con mensaje claro (no se decodifica — ver [procesarFoto]). Si el
 * procesado falla devuelve una clave i18n clara (no un 500 mudo).
 *
 * Orden anti-huérfanos: (1) procesa, (2) inserta la fila `media` con el cliente
 * del usuario — la **RLS** autoriza (admin o autor de la publicación), (3) sube
 * los objetos con service role a las rutas deterministas, (4) si la subida falla
 * borra la fila. Devuelve la media con enlaces firmados (~1 h) para el preview.
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('fotos.errors.no_autorizado', 401)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return err('fotos.errors.subida_fallo')
  }

  const file = form.get('file')
  const publicacionId = form.get('publicacion_id')
  if (!(file instanceof Blob) || typeof publicacionId !== 'string') {
    return err('fotos.errors.subida_fallo')
  }

  // Tope de 4 MB (margen bajo el límite de 4,5 MB del body de Vercel) ANTES de
  // procesar — para no fallar en silencio.
  if (file.size > MAX_BYTES_FOTO) return err('fotos.validation.tamano_max')

  const parsed = subirFotoSchema.safeParse({ publicacion_id: publicacionId, mime: file.type })
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? 'fotos.validation.tipo_no_permitido')
  }

  // Publicación visible para el usuario (RLS). Nos da centro_id/aula_id para la ruta.
  const { data: pub } = await supabase
    .from('publicaciones')
    .select('id, centro_id, aula_id')
    .eq('id', parsed.data.publicacion_id)
    .maybeSingle()
  if (!pub) return err('fotos.errors.no_autorizado', 403)

  // Límite de fotos por publicación (P4).
  const { count } = await supabase
    .from('media')
    .select('id', { count: 'exact', head: true })
    .eq('publicacion_id', pub.id)
  if ((count ?? 0) >= MAX_FOTOS_PUBLICACION) return err('fotos.validation.max_fotos')

  // 1. Procesado (sharp). Lanza FotoInvalidaError con clave i18n.
  let procesada
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    procesada = await procesarFoto(buf)
  } catch (e) {
    if (e instanceof FotoInvalidaError) return err(e.clave)
    logger.warn('fotos/upload: procesarFoto', e instanceof Error ? e.message : 'desconocido')
    return err('fotos.errors.procesado_fallo', 500)
  }

  const prefijo = prefijoPublicacion(pub.centro_id, pub.aula_id, pub.id)
  const rutas = rutasFotoNueva(prefijo)

  // 2. Fila media con el cliente del usuario → la RLS autoriza la escritura.
  const { data: media, error: insErr } = await supabase
    .from('media')
    .insert({
      publicacion_id: pub.id,
      centro_id: pub.centro_id,
      bucket: BUCKET_AULA_FOTOS,
      path: rutas.original,
      path_miniatura: rutas.miniatura,
      hash: procesada.hash,
      mime: MIME_FOTO_SALIDA,
      ancho: procesada.ancho,
      alto: procesada.alto,
      bytes: procesada.bytes,
    })
    .select('id')
    .maybeSingle()

  if (insErr || !media) {
    if (insErr?.code === '42501') return err('fotos.errors.no_autorizado', 403)
    logger.warn('fotos/upload: media.insert', insErr?.message)
    return err('fotos.errors.subida_fallo', 500)
  }

  // 3. Sube los objetos con service role (ya autorizado).
  const service = createServiceRoleClient()
  const subirOriginal = await service.storage
    .from(BUCKET_AULA_FOTOS)
    .upload(rutas.original, procesada.original, { contentType: MIME_FOTO_SALIDA, upsert: false })
  const subirMini = await service.storage
    .from(BUCKET_AULA_FOTOS)
    .upload(rutas.miniatura, procesada.miniatura, { contentType: MIME_FOTO_SALIDA, upsert: false })

  if (subirOriginal.error || subirMini.error) {
    // 4. Rollback: sin objetos no debe quedar la fila ni objetos a medias.
    await service.from('media').delete().eq('id', media.id)
    await service.storage
      .from(BUCKET_AULA_FOTOS)
      .remove([rutas.original, rutas.miniatura])
      .catch(() => undefined)
    logger.warn(
      'fotos/upload: storage.upload',
      subirOriginal.error?.message ?? subirMini.error?.message
    )
    return err('fotos.errors.subida_fallo', 500)
  }

  const firmadas = await firmarRutas(service, [rutas.original, rutas.miniatura])

  return Response.json({
    success: true,
    media: {
      id: media.id,
      ancho: procesada.ancho,
      alto: procesada.alto,
      url: firmadas.get(rutas.original) ?? null,
      urlMiniatura: firmadas.get(rutas.miniatura) ?? null,
    },
  } satisfies RespuestaOk)
}
