import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

type GenArgs = Database['public']['Functions']['registrar_mandato_sepa']['Args']

/**
 * Args tipados de las RPC de mandato SEPA. `registrar_mandato_sepa` y
 * `sustituir_mandato_sepa` tienen firmas IDÉNTICAS. El type-gen de Supabase marca varios
 * params como `string`, pero en SQL son uuid/text **OPCIONALES que aceptan NULL**:
 * `p_nino_id` (informativo: qué niño originó el alta), y en el flujo PRESENCIAL también
 * `p_documento_path` (sin PDF), `p_texto_hash` (la RPC no lo exige) y `p_user_agent`. Este
 * tipo refleja esa nullabilidad real para que los call sites la expresen sin castear.
 */
export type MandatoSepaRpcArgs = Omit<
  GenArgs,
  'p_nino_id' | 'p_documento_path' | 'p_texto_hash' | 'p_user_agent'
> & {
  p_nino_id: string | null
  p_documento_path: string | null
  p_texto_hash: string | null
  p_user_agent: string | null
}

/**
 * Registra (1er mandato) o sustituye (con mandato activo previo) el mandato SEPA de una
 * familia. El nombre de la RPC es dinámico (`registrar`/`sustituir`); se llama con el nombre
 * **literal** en cada rama para que TS compruebe los params de cada una — antes cada call
 * site usaba `rpc(rpc, { ... } as never)`, que silenciaba toda la verificación de tipos.
 *
 * El ÚNICO cast (`as GenArgs`, un downcast comparable) queda AISLADO aquí: convierte el tipo
 * preciso `MandatoSepaRpcArgs` (con la nullabilidad real) al tipo generado impreciso que
 * espera `supabase.rpc`. Los call sites quedan totalmente tipados, sin escapes.
 */
export async function registrarOSustituirMandatoSepa(
  supabase: SupabaseClient<Database>,
  activo: boolean,
  args: MandatoSepaRpcArgs
) {
  const generated = args as GenArgs
  return activo
    ? await supabase.rpc('sustituir_mandato_sepa', generated)
    : await supabase.rpc('registrar_mandato_sepa', generated)
}
