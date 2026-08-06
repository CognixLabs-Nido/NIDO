import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

/**
 * U-5 — gate "¿soy admin de ESTE centro?" para las acciones de admisiones que leen por
 * SERVICE ROLE (la detección de tutor por email consulta `auth.users` y `roles_usuario`,
 * fuera del alcance del admin por RLS). Donde todo va por el cliente autenticado basta la
 * propia RLS (`lista_espera_admin_all`); aquí no, así que el gate se hace explícito.
 *
 * Extraído de `anadirHijoAFamilia` (U-2), que hacía esta misma comprobación inline antes de
 * jubilarse: mismo criterio, un solo sitio.
 */
export async function esAdminDelCentro(
  supabase: SupabaseClient<Database>,
  centroId: string
): Promise<boolean> {
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return false

  const { data: roles } = await supabase
    .from('roles_usuario')
    .select('rol, centro_id')
    .eq('usuario_id', userData.user.id)
    .is('deleted_at', null)

  return (roles ?? []).some((r) => r.centro_id === centroId && r.rol === 'admin')
}
