import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F-3-A — núcleos testeables de las mutaciones de rollover (cliente inyectable, patrón
 * `getEstadoRolloverCore`). Aquí vive la EXCLUSIÓN MUTUA pendiente↔finaliza: marcar
 * Finaliza borra la matrícula pendiente y viceversa. Es la red que sustituye al trigger
 * de BD (decisión F-3-A.3), verificada por tests. Las server actions son wrappers finos
 * (parse + createClient + revalidatePath).
 */

type DB = SupabaseClient<Database>

/**
 * El destino debe existir y seguir `planificado` (no se toca un rollover ya confirmado).
 * Devuelve el `centroId` del curso para poblar `centro_id` en los inserts (convención
 * del repo: se pasa explícito aunque el trigger `set_centro_id` lo derive — igual que
 * `aulas_curso` en `create-aula`/`copiar-config-curso`).
 */
async function destinoPlanificado(
  supabase: DB,
  cursoDestinoId: string
): Promise<ActionResult<{ centroId: string }>> {
  const { data: destino } = await supabase
    .from('cursos_academicos')
    .select('estado, centro_id')
    .eq('id', cursoDestinoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!destino) return fail('rollover.errors.destino_no_encontrado')
  if (destino.estado !== 'planificado') return fail('rollover.errors.destino_no_planificado')
  return ok({ centroId: destino.centro_id })
}

/**
 * Marca a un niño como "Finaliza" en el curso destino: borra su matrícula `pendiente`
 * (exclusión mutua) y registra la fila `rollover_finaliza` (idempotente por UNIQUE).
 */
export async function marcarFinalizaCore(
  supabase: DB,
  cursoDestinoId: string,
  ninoId: string
): Promise<ActionResult<void>> {
  const g = await destinoPlanificado(supabase, cursoDestinoId)
  if (!g.success) return g

  // Exclusión mutua: si tenía una propuesta de aula, se retira.
  const { error: delErr } = await supabase
    .from('matriculas')
    .delete()
    .eq('nino_id', ninoId)
    .eq('curso_academico_id', cursoDestinoId)
    .eq('estado', 'pendiente')
  if (delErr) {
    logger.warn('marcarFinaliza borrar pendiente', delErr.message)
    return fail('rollover.errors.finaliza_fallo')
  }

  // Registra la decisión. `centro_id` se pasa explícito (convención del repo) aunque el
  // trigger lo derive del curso. Idempotente por UNIQUE(curso, niño).
  const { error: insErr } = await supabase
    .from('rollover_finaliza')
    .upsert(
      { centro_id: g.data.centroId, curso_academico_id: cursoDestinoId, nino_id: ninoId },
      { onConflict: 'curso_academico_id,nino_id', ignoreDuplicates: true }
    )
  if (insErr) {
    logger.warn('marcarFinaliza upsert', insErr.message)
    return fail('rollover.errors.finaliza_fallo')
  }
  return ok(undefined)
}

/**
 * Asigna (o reasigna) a un niño una sala del curso destino en la propuesta. Opera SOLO
 * sobre `pendiente`. Exclusión mutua: si estaba en "Finaliza", se saca de Finaliza.
 */
export async function asignarAulaPropuestaCore(
  supabase: DB,
  cursoDestinoId: string,
  ninoId: string,
  aulaId: string
): Promise<ActionResult<{ id: string }>> {
  const g = await destinoPlanificado(supabase, cursoDestinoId)
  if (!g.success) return fail(g.error)

  // La sala debe estar configurada en el curso destino (error claro; la FK lo exigiría).
  const { data: aulaCfg } = await supabase
    .from('aulas_curso')
    .select('aula_id')
    .eq('aula_id', aulaId)
    .eq('curso_academico_id', cursoDestinoId)
    .maybeSingle()
  if (!aulaCfg) return fail('rollover.errors.aula_no_en_destino')

  // Exclusión mutua: sacar de "Finaliza" si estaba.
  const { error: finErr } = await supabase
    .from('rollover_finaliza')
    .delete()
    .eq('nino_id', ninoId)
    .eq('curso_academico_id', cursoDestinoId)
  if (finErr) {
    logger.warn('asignarAulaPropuesta borrar finaliza', finErr.message)
    return fail('rollover.errors.asignar_fallo')
  }

  // ¿Ya hay una pendiente para este niño en el destino? → update; si no, insert.
  const { data: existente } = await supabase
    .from('matriculas')
    .select('id, estado')
    .eq('nino_id', ninoId)
    .eq('curso_academico_id', cursoDestinoId)
    .is('deleted_at', null)
    .maybeSingle()

  if (existente) {
    if (existente.estado !== 'pendiente') return fail('rollover.errors.no_pendiente')
    const { error } = await supabase
      .from('matriculas')
      .update({ aula_id: aulaId })
      .eq('id', existente.id)
    if (error) {
      logger.warn('asignarAulaPropuesta update', error.message)
      return fail('rollover.errors.asignar_fallo')
    }
    return ok({ id: existente.id })
  }

  const { data: nueva, error } = await supabase
    .from('matriculas')
    .insert({
      nino_id: ninoId,
      aula_id: aulaId,
      curso_academico_id: cursoDestinoId,
      estado: 'pendiente',
    })
    .select('id')
    .single()
  if (error || !nueva) {
    logger.warn('asignarAulaPropuesta insert', error?.message)
    return fail('rollover.errors.asignar_fallo')
  }
  return ok({ id: nueva.id })
}

/**
 * Descarta la propuesta del curso destino: borra TODAS las matrículas `pendiente` Y
 * TODAS las filas `rollover_finaliza` de ese curso (reset global — decisión F-3-A.2).
 */
export async function descartarPropuestaCore(
  supabase: DB,
  cursoDestinoId: string
): Promise<ActionResult<{ borradas: number }>> {
  const g = await destinoPlanificado(supabase, cursoDestinoId)
  if (!g.success) return fail(g.error)

  const { data: borradas, error } = await supabase
    .from('matriculas')
    .delete()
    .eq('curso_academico_id', cursoDestinoId)
    .eq('estado', 'pendiente')
    .select('id')
  if (error) {
    logger.warn('descartarPropuesta pendientes', error.message)
    return fail('rollover.errors.descartar_fallo')
  }

  const { error: finErr } = await supabase
    .from('rollover_finaliza')
    .delete()
    .eq('curso_academico_id', cursoDestinoId)
  if (finErr) {
    logger.warn('descartarPropuesta finaliza', finErr.message)
    return fail('rollover.errors.descartar_fallo')
  }

  return ok({ borradas: (borradas ?? []).length })
}
