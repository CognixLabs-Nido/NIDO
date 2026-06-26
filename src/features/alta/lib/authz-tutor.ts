import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

const VINCULOS_LEGALES = ['tutor_legal_principal', 'tutor_legal_secundario'] as const

/**
 * ¿El usuario es tutor LEGAL (principal/secundario, no `autorizado`) del niño? Lee
 * `vinculos_familiares` con el cliente del USUARIO (la RLS deja al tutor ver su vínculo).
 * Espejo en app de `es_tutor_legal_de` para autorizar escrituras service-role sobre las
 * columnas nuevas de `ninos` que no tienen vía RLS para el tutor (F11-G).
 */
export async function esTutorLegalDe(
  userClient: Client,
  ninoId: string,
  usuarioId: string
): Promise<boolean> {
  const { data } = await userClient
    .from('vinculos_familiares')
    .select('tipo_vinculo')
    .eq('nino_id', ninoId)
    .eq('usuario_id', usuarioId)
    .is('deleted_at', null)
  return (data ?? []).some((v) => (VINCULOS_LEGALES as readonly string[]).includes(v.tipo_vinculo))
}
