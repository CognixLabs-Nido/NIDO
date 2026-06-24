'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { computarPropuesta, type ResultadoPropuesta } from '../lib/proponer'
import { getEstadoRolloverCore } from '../queries/get-estado-rollover'
import { proponerMatriculasSchema, type ProponerMatriculasInput } from '../schemas/rollover'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-2: auto-propone matrículas para el curso destino a partir de los niños
 * activos del curso origen, mapeando cada uno a la sala destino por edad
 * (decisión C/F). Persiste como matrículas `pendiente` en el curso planificado
 * (decisión de robustez: viven en BD, invisibles a staff por RLS hasta confirmar).
 *
 * Solo persiste las propuestas DIRECTAS (1 sala candidata). Los graduados (sin
 * sala) y los que requieren elección (≥2 salas o sin fecha) se DEVUELVEN para que
 * la directora los resuelva a mano vía `asignarAulaPropuesta`. Idempotente: los
 * niños que ya tienen matrícula en el destino se ignoran.
 */
export async function proponerMatriculas(
  input: ProponerMatriculasInput
): Promise<ActionResult<ResultadoPropuesta & { insertadas: number }>> {
  const parsed = proponerMatriculasSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'rollover.validation.invalid')

  const supabase = await createClient()
  const estado = await getEstadoRolloverCore(supabase, parsed.data.curso_destino_id)
  if (!estado) return fail('rollover.errors.destino_no_encontrado')
  if (estado.cursoDestino.estado !== 'planificado')
    return fail('rollover.errors.destino_no_planificado')
  if (!estado.cursoOrigen) return fail('rollover.errors.sin_curso_activo')
  if (estado.aulasDestino.length === 0) return fail('rollover.errors.sin_aulas_destino')

  const yaConDestino = new Set(estado.pendientes.map((p) => p.nino_id))
  const resultado = computarPropuesta(estado.ninosActivos, estado.aulasDestino, yaConDestino)

  let insertadas = 0
  if (resultado.propuestas.length > 0) {
    const filas = resultado.propuestas.map((p) => ({
      nino_id: p.nino_id,
      aula_id: p.aula_destino_id,
      curso_academico_id: parsed.data.curso_destino_id,
      estado: 'pendiente' as const,
    }))
    const { error } = await supabase.from('matriculas').insert(filas)
    if (error) {
      logger.warn('proponerMatriculas insert', error.message)
      return fail('rollover.errors.proponer_fallo')
    }
    insertadas = filas.length
  }

  revalidatePath('/[locale]/admin/pasar-de-curso', 'page')
  return ok({ ...resultado, insertadas })
}
