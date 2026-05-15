import 'server-only'

import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

/**
 * Devuelve `true` si el usuario actual está vinculado al niño con
 * `permisos.puede_ver_agenda = true`. Para admins o profes el RLS de la
 * tabla `agendas_diarias` resuelve el acceso por otra vía: esta función
 * es específica para la vista FAMILIA (decide si renderizamos la tab o
 * el empty-state "sin permiso").
 *
 * Cacheada per-request con `React.cache()`.
 */
export const getPermisoAgendaParaUsuario = cache(async (ninoId: string): Promise<boolean> => {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return false

  const { data } = await supabase
    .from('vinculos_familiares')
    .select('permisos')
    .eq('usuario_id', userId)
    .eq('nino_id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()

  const permisos = (data?.permisos as Record<string, boolean> | null) ?? {}
  return permisos.puede_ver_agenda === true
})
