'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { ninosSinResolver } from '../lib/proponer'
import { getEstadoRolloverCore } from '../queries/get-estado-rollover'
import { cursoDestinoSchema, type CursoDestinoInput } from '../schemas/rollover'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-2 + F-3-C-2: confirma el "pasar de curso".
 *
 *  1. GATE DE COMPLETITUD (F-3-A, en TS): ningún niño activo del curso origen
 *     puede quedar sin destino resuelto. Pre-chequeo antes de la RPC; el conteo se
 *     muestra en la UI. (La atomicidad del cierre la garantiza la RPC, no este
 *     gate; una carrera improbable entre el gate y la RPC solo afectaría a un niño
 *     recién dejado sin resolver, que la RPC simplemente no procesaría.)
 *  2. RPC `cerrar_curso` (F-3-C-2): TODO el cierre en UNA transacción SQL
 *     (todo-o-nada) — archiva finalizadores + revoca familias vacías, cierra la
 *     matrícula VIEJA de los que continúan (arreglo de la fuga multicurso), cierra
 *     las profes_aulas viejas, hace el flip pendiente→activa del destino y activa
 *     el curso destino cerrando el saliente. Si algo falla, revierte entero y el
 *     curso NO queda cerrado (el error crudo es el reporte; se corrige y reintenta).
 *
 * La parte atómica (antes repartida en un flip PostgREST + `activarCurso`) vive
 * ahora ÍNTEGRA en la RPC; esta server action solo la invoca. `activarCurso`
 * sigue existiendo para su propio botón de "activar curso" (fuera del rollover).
 */
export async function confirmarRollover(input: CursoDestinoInput): Promise<ActionResult<void>> {
  const parsed = cursoDestinoSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'rollover.validation.invalid')
  const cursoId = parsed.data.curso_destino_id

  const supabase = await createClient()

  const estado = await getEstadoRolloverCore(supabase, cursoId)
  if (!estado) return fail('rollover.errors.destino_no_encontrado')
  if (estado.cursoDestino.estado === 'activo') return ok(undefined) // ya confirmado (idempotente)
  if (estado.cursoDestino.estado !== 'planificado')
    return fail('rollover.errors.destino_no_planificado')

  // 1) F-3-A — GATE DE COMPLETITUD (pre-chequeo, ANTES de la RPC).
  const pendSet = new Set(estado.pendientes.map((p) => p.nino_id))
  const finSet = new Set(estado.finalizados)
  if (ninosSinResolver(estado.ninosActivos, pendSet, finSet).length > 0) {
    return fail('rollover.errors.incompletos')
  }

  // 2) Cierre atómico completo (todo-o-nada) en la RPC.
  const { error: cierreErr } = await supabase.rpc('cerrar_curso', {
    p_curso_destino_id: cursoId,
  })
  if (cierreErr) {
    logger.warn('confirmarRollover cerrar_curso', cierreErr.message)
    return fail('rollover.errors.confirmar_fallo')
  }

  revalidatePath('/[locale]/admin/pasar-de-curso', 'page')
  revalidatePath('/[locale]/admin/cursos', 'page')
  return ok(undefined)
}
