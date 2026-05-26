import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Devuelve el id del centro al que pertenece el usuario autenticado.
 * En Ola 1 solo existe un centro (ANAIA), pero esta utility está pensada
 * para que en el futuro el mismo usuario pueda navegar entre varios.
 * Devuelve null si no hay sesión o el usuario no tiene rol activo.
 */
export async function getCentroActualId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null

  const { data } = await supabase
    .from('roles_usuario')
    .select('centro_id')
    .eq('usuario_id', userData.user.id)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  return data?.centro_id ?? null
}

/**
 * Devuelve el rol activo del usuario en el centro, priorizando el rol con
 * más privilegios cuando un usuario tiene varios activos (admin > profe >
 * tutor_legal > autorizado).
 *
 * Antes del hotfix post-F5 esto era un `limit(1)` sin orden estable, lo
 * que podía hacer que un admin con doble rol "admin + profe" se viera
 * como "profe" en server components, ocultando ámbitos del composer de
 * anuncios y el tab de conversaciones. La policy de BD nunca dejaba al
 * usuario insertar sin permiso, pero la UI mostraba opciones equivocadas
 * y daba la sensación de "No tienes acceso" al elegir un aula del centro.
 */
const PRIORIDAD_ROL: Record<string, number> = {
  admin: 4,
  profe: 3,
  tutor_legal: 2,
  autorizado: 1,
}

export async function getRolEnCentro(centroId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null

  const { data } = await supabase
    .from('roles_usuario')
    .select('rol')
    .eq('usuario_id', userData.user.id)
    .eq('centro_id', centroId)
    .is('deleted_at', null)

  if (!data || data.length === 0) return null

  // Si solo hay uno, evitamos el sort.
  if (data.length === 1) return data[0]!.rol

  let mejor = data[0]!.rol
  let mejorScore = PRIORIDAD_ROL[mejor] ?? 0
  for (const r of data.slice(1)) {
    const score = PRIORIDAD_ROL[r.rol] ?? 0
    if (score > mejorScore) {
      mejor = r.rol
      mejorScore = score
    }
  }
  return mejor
}
