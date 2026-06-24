import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

type ServiceClient = SupabaseClient<Database>

/**
 * Auto-vínculo profe↔aula al aceptar la invitación de profe (rama F11-C-2). Vive en
 * un módulo lib (no `'use server'`) para poder testearlo de forma aislada SIN
 * exponerlo como server action: recibe un cliente SERVICE-ROLE que bypassa la RLS,
 * así que jamás debe ser invocable desde el cliente.
 *
 * Inserta en `profes_aulas` por service-role porque el profe recién creado no es
 * admin del centro y la RLS `profes_aulas_admin_all` le daría `42501`. El
 * `fecha_inicio` lo pone el DEFAULT `CURRENT_DATE` de la columna; `tipo_personal_aula`
 * viene de la invitación (default `'profesora'` si una invitación legacy viniera con
 * NULL — análogo al fallback de `tipo_vinculo` en el auto-vínculo familiar).
 *
 * Red del 23505 (decisión E de onboarding-profe): aunque la coordinadora-única se
 * valida AL INVITAR (F11-C-1), dos invitaciones pendientes como `coordinadora` a la
 * misma aula podrían colisionar aquí al aceptar. El índice único parcial de
 * coordinadora devuelve `23505`; lo capturamos y devolvemos un mensaje amable en vez
 * de romper el accept. El caller decide si conserva la cuenta (conflicto recuperable)
 * o hace rollback (fallo genérico de inserción).
 */
export async function crearVinculoProfeAula(
  service: ServiceClient,
  params: {
    profeId: string
    aulaId: string
    tipoPersonalAula: Database['public']['Enums']['tipo_personal_aula'] | null
  }
): Promise<{ error: string | null }> {
  // F11-H: la asignación de personal es por curso. Se vincula al curso ACTIVO
  // del centro del aula (el único operativo en el momento de aceptar).
  const { data: aulaRow } = await service
    .from('aulas')
    .select('centro_id')
    .eq('id', params.aulaId)
    .maybeSingle()
  if (!aulaRow) return { error: 'auth.invitation.errors.profe_aula_failed' }

  const { data: cursoActivoId } = await service.rpc('curso_activo_de_centro', {
    p_centro_id: aulaRow.centro_id,
  })
  if (!cursoActivoId) return { error: 'auth.invitation.errors.sin_curso_activo' }

  const { error } = await service.from('profes_aulas').insert({
    profe_id: params.profeId,
    aula_id: params.aulaId,
    curso_academico_id: cursoActivoId,
    tipo_personal_aula: params.tipoPersonalAula ?? 'profesora',
  })
  if (error) {
    logger.warn('auto-vínculo profe falló', error.message)
    if (error.code === '23505') return { error: 'auth.invitation.errors.coordinadora_ocupada' }
    return { error: 'auth.invitation.errors.profe_aula_failed' }
  }
  return { error: null }
}
