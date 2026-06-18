import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { BUCKET_CARTILLA_VACUNAS, firmarRuta } from '@/shared/lib/adjuntos/storage'

/**
 * Firma la cartilla de vacunas (`info_medica_emergencia.cartilla_vacunas_path`) para
 * poder ABRIRLA y verificar que es el documento correcto (no una foto cualquiera).
 * Espejo de `firmarFotoNino`: se firma con el cliente del usuario, así que la RLS de
 * `storage.objects` decide quién puede leer el objeto privado del bucket
 * `cartilla-vacunas` — `cartilla_tutor_select` (tutor del niño) y `cartilla_staff_select`
 * (admin/profe del centro). Sin path o sin acceso → null. NO usa service role.
 */
export async function firmarRutaCartilla(path: string | null): Promise<string | null> {
  if (!path) return null
  const supabase = await createClient()
  return firmarRuta(supabase, BUCKET_CARTILLA_VACUNAS, path)
}
