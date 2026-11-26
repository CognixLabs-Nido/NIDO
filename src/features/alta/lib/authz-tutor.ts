import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { esAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { LecturaFallida } from '@/shared/lib/lectura-fallida'
import type { Database } from '@/types/db'

type Client = SupabaseClient<Database>

const VINCULOS_LEGALES = ['tutor_legal_principal', 'tutor_legal_secundario'] as const

/**
 * ¿El usuario es tutor LEGAL (principal/secundario, no `autorizado`) del niño? Lee
 * `vinculos_familiares` con el cliente del USUARIO (la RLS deja al tutor ver su vínculo).
 * Espejo en app de `es_tutor_legal_de` para autorizar escrituras service-role sobre las
 * columnas nuevas de `ninos` que no tienen vía RLS para el tutor (F11-G).
 *
 * Censo C (2026-11-26): una lectura caída lanza `LecturaFallida`; antes era `false` y quien llama decía
 * «no autorizado» a un tutor que sí lo es. Sus llamadores la recogen (`falloDeLectura`, o la ruta).
 */
export async function esTutorLegalDe(
  userClient: Client,
  ninoId: string,
  usuarioId: string
): Promise<boolean> {
  const { data, error } = await userClient
    .from('vinculos_familiares')
    .select('tipo_vinculo')
    .eq('nino_id', ninoId)
    .eq('usuario_id', usuarioId)
    .is('deleted_at', null)
  if (error) throw new LecturaFallida('esTutorLegalDe', error)
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
  const { data: nino, error } = await userClient
    .from('ninos')
    .select('centro_id')
    .eq('id', ninoId)
    .maybeSingle()
  // Censo C: una lectura caída no es «no es de Dirección» (la misma regla que `esTutorLegalDe`).
  if (error) throw new LecturaFallida('esAdminDeCentroDeNino', error)
  if (!nino?.centro_id) return false
  return esAdminEn(userClient, usuarioId, nino.centro_id)
}
