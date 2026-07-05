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

/**
 * PR-3b-2 · B2 — ¿el usuario es ADMIN del CENTRO DEL NIÑO? Espejo en app de
 * `es_admin(centro_de_nino(...))`, atado al centro del niño (NO al centro "actual"):
 * lee `ninos.centro_id` y comprueba un rol `admin` activo del usuario en ESE centro,
 * con el cliente del USUARIO (RLS). Cada write-path del modo "Completa Dirección"
 * RE-DERIVA con esto server-side quién carga la documentación en papel — NUNCA se fía
 * de un flag del cliente ni de la URL (mismo criterio que el gate de entrada de B1).
 *
 * Un usuario sin acceso al niño no puede leer `ninos` por RLS → `centro_id` null →
 * false. Un admin de OTRO centro no tiene rol en el centro del niño → false. Se usa
 * con OR junto a `esTutorLegalDe` (nunca lo sustituye): el camino tutor queda intacto.
 */
export async function esAdminDeCentroDeNino(
  userClient: Client,
  ninoId: string,
  usuarioId: string
): Promise<boolean> {
  const { data: nino } = await userClient
    .from('ninos')
    .select('centro_id')
    .eq('id', ninoId)
    .maybeSingle()
  if (!nino?.centro_id) return false
  const { data } = await userClient
    .from('roles_usuario')
    .select('rol')
    .eq('usuario_id', usuarioId)
    .eq('centro_id', nino.centro_id)
    .eq('rol', 'admin')
    .is('deleted_at', null)
    .limit(1)
  return (data?.length ?? 0) > 0
}
