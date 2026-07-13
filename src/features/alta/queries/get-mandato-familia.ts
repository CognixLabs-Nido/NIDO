import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface MandatoFamiliaActivo {
  ultimos4: string | null
  titular: string
  identificador_mandato: string
}

/**
 * F-2c-2 — ¿la FAMILIA tiene un mandato SEPA activo? (camino del TUTOR en el wizard de
 * alta). Resuelve `mandatos_sepa` por `familia_id` (el mandato es de la familia desde
 * F-2c-1) y devuelve solo lo necesario para el INFORMATIVO del paso 8: los últimos 4
 * dígitos (enmascarado `****1234`), el titular y el identificador. NUNCA devuelve el IBAN
 * completo ni el cifrado. Devuelve `null` si la familia no tiene mandato activo.
 *
 * RLS: `mandatos_sepa_select` ya autoriza `es_admin(centro) OR es_tutor_de_familia(familia)`,
 * así que el tutor de la familia lo lee con su cliente autenticado (sin service role, sin RPC
 * de descifrado). Patrón hermano de `getAltaDocumentacion` (admin-facing), aquí tutor-facing.
 */
export async function familiaTieneMandatoActivo(
  familiaId: string
): Promise<MandatoFamiliaActivo | null> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('mandatos_sepa')
    .select('iban_ultimos4, titular, identificador_mandato')
    .eq('familia_id', familiaId)
    .eq('estado', 'activo')
    .is('deleted_at', null)
    .order('fecha_firma', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  return {
    ultimos4: data.iban_ultimos4,
    titular: data.titular,
    identificador_mandato: data.identificador_mandato,
  }
}
