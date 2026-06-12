import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { BUCKET_NINOS_FOTOS, firmarRutasBucket, rutaThumbDe } from '@/shared/lib/adjuntos/storage'

export interface FotoNinoFirmada {
  /** Enlace firmado (~1 h) del original; null si no hay foto o sin acceso. */
  url: string | null
  /** Enlace firmado (~1 h) de la miniatura/avatar. */
  urlMiniatura: string | null
}

/**
 * Firma la foto del niño (`ninos.foto_url`) para mostrarla. Se firma con el
 * cliente del usuario: la RLS de `storage.objects` (F10-0 `ninos_fotos_select`:
 * admin/profe/tutor) decide quién puede leer el objeto privado. Sin foto o sin
 * acceso → enlaces null.
 */
export async function firmarFotoNino(fotoUrl: string | null): Promise<FotoNinoFirmada> {
  if (!fotoUrl) return { url: null, urlMiniatura: null }
  const supabase = await createClient()
  const thumb = rutaThumbDe(fotoUrl)
  const m = await firmarRutasBucket(supabase, BUCKET_NINOS_FOTOS, [fotoUrl, thumb])
  return { url: m.get(fotoUrl) ?? null, urlMiniatura: m.get(thumb) ?? null }
}
