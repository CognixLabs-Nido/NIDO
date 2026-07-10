'use server'

import { revalidatePath } from 'next/cache'

import { activarCurso } from '@/features/cursos/actions/activar-curso'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { ninosSinResolver } from '../lib/proponer'
import { getEstadoRolloverCore } from '../queries/get-estado-rollover'
import { cursoDestinoSchema, type CursoDestinoInput } from '../schemas/rollover'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-2: confirma el "pasar de curso". Dos pasos, en ESTE orden por seguridad:
 *
 *  1. Pasa las matrículas `pendiente` del curso destino a `activa`. Se hace
 *     MIENTRAS el curso sigue `planificado` → siguen invisibles para el staff
 *     (la RLS de profe filtra por curso activo, no por estado). Así no hay ninguna
 *     ventana en la que el staff vea pendientes.
 *  2. Activa el curso destino (`activarCurso` cierra el activo anterior y abre
 *     este). A partir de aquí las matrículas (ya `activa`) son las operativas.
 *
 * No es transaccional desde el cliente (decisión J: sin RPC SQL nuevo), pero el
 * orden elegido deja cualquier corte intermedio en estado consistente: tras el
 * paso 1 el curso sigue planificado (nada cambió operativamente); el paso 2 es el
 * único que "publica" el rollover.
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

  // F-3-A — GATE DE COMPLETITUD: ningún niño activo del curso origen puede quedar sin
  // destino resuelto (ni matrícula pendiente = aula, ni fila `rollover_finaliza`). Va
  // ANTES del flip: si falta alguno, no se confirma. El conteo se muestra en la UI.
  const pendSet = new Set(estado.pendientes.map((p) => p.nino_id))
  const finSet = new Set(estado.finalizados)
  if (ninosSinResolver(estado.ninosActivos, pendSet, finSet).length > 0) {
    return fail('rollover.errors.incompletos')
  }

  // 1) pendiente → activa (aún planificado = invisible para staff).
  const { error: flipErr } = await supabase
    .from('matriculas')
    .update({ estado: 'activa' })
    .eq('curso_academico_id', cursoId)
    .eq('estado', 'pendiente')
  if (flipErr) {
    logger.warn('confirmarRollover flip', flipErr.message)
    return fail('rollover.errors.confirmar_fallo')
  }

  // 2) activar el curso destino (cierra el activo previo).
  const res = await activarCurso(cursoId)
  if (!res.success) return fail(res.error)

  revalidatePath('/[locale]/admin/pasar-de-curso', 'page')
  revalidatePath('/[locale]/admin/cursos', 'page')
  return ok(undefined)
}
