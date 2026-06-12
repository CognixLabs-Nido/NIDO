import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { FotoInvalidaError } from '@/features/fotos/lib/procesar-foto'
import { MAX_BYTES_ADJUNTO, procesarLogo } from '@/shared/lib/adjuntos/procesar-imagen'
import { BUCKET_CENTRO_ASSETS, urlPublica } from '@/shared/lib/adjuntos/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RespuestaOk {
  success: true
  logo: { url: string }
}
interface RespuestaError {
  success: false
  error: string
}

function err(error: string, status = 400): Response {
  return Response.json({ success: false, error } satisfies RespuestaError, { status })
}

/**
 * Subida + procesado del **logo del centro** (F10-3, ADR-0010; bucket PÚBLICO
 * `centro-assets`). La sube **dirección** desde la configuración del centro y
 * sustituye la URL hardcodeada. `sharp` quita metadatos, reescala y **conserva la
 * transparencia** (PNG). Ruta fija `{centroId}/logo.png` (se sobrescribe al
 * sustituir). Autoriza la **RLS de `storage.objects`** (F10-0 `centro_assets_*` =
 * admin del centro) en la subida con el cliente del usuario; el `UPDATE` de
 * `centros.logo_url` lo acota la RLS de `centros` (admin).
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('centro.logo.no_autorizado', 401)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return err('centro.logo.subida_fallo')
  }
  const file = form.get('file')
  const centroId = form.get('centro_id')
  if (!(file instanceof Blob) || typeof centroId !== 'string') {
    return err('centro.logo.subida_fallo')
  }
  if (file.size > MAX_BYTES_ADJUNTO) return err('fotos.validation.tamano_max')

  // 1. Procesado (sharp). Lanza FotoInvalidaError con clave i18n.
  let procesada
  try {
    procesada = await procesarLogo(Buffer.from(await file.arrayBuffer()))
  } catch (e) {
    if (e instanceof FotoInvalidaError) return err(e.clave)
    logger.warn('centro/logo: procesar', e instanceof Error ? e.message : 'desconocido')
    return err('fotos.errors.procesado_fallo', 500)
  }

  const path = `${centroId}/logo.png`

  // 2. Subida con el cliente del usuario → la RLS de storage autoriza (admin).
  const { error: upErr } = await supabase.storage
    .from(BUCKET_CENTRO_ASSETS)
    .upload(path, procesada.original, { contentType: 'image/png', upsert: true })
  if (upErr) {
    if (/row-level security|unauthorized|403/i.test(upErr.message)) {
      return err('centro.logo.no_autorizado', 403)
    }
    logger.warn('centro/logo: upload', upErr.message)
    return err('centro.logo.subida_fallo', 500)
  }

  // 3. URL pública con cache-bust (el path es fijo) + repunte de centros.logo_url.
  const url = `${urlPublica(supabase, BUCKET_CENTRO_ASSETS, path)}?v=${procesada.hash.slice(0, 8)}`
  const { error: updErr } = await supabase
    .from('centros')
    .update({ logo_url: url })
    .eq('id', centroId)
  if (updErr) {
    if (updErr.code === '42501') return err('centro.logo.no_autorizado', 403)
    logger.warn('centro/logo: update logo_url', updErr.message)
    return err('centro.logo.subida_fallo', 500)
  }

  return Response.json({ success: true, logo: { url } } satisfies RespuestaOk)
}
