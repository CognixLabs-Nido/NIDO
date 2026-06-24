'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { copiarConfigSchema, type CopiarConfigInput } from '../schemas/rollover'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-2: copia la configuración del curso ACTIVO al curso destino (planificado)
 * como semilla editable (decisión A). Modelo B1: el `tramo_edad` de cada sala se
 * copia tal cual (las salas mantienen su franja; el niño es quien sube de sala).
 * Opcionalmente copia también las asignaciones de personal (decisión G).
 *
 * Idempotente: salta las aulas/personal que ya existan en el destino, así que se
 * puede reejecutar sin duplicar (reanudar la preparación del rollover).
 */
export async function copiarConfigCurso(
  input: CopiarConfigInput
): Promise<ActionResult<{ aulasCopiadas: number; personalCopiado: number }>> {
  const parsed = copiarConfigSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'rollover.validation.invalid')
  const { curso_destino_id, incluir_personal } = parsed.data

  const supabase = await createClient()

  // Destino: debe existir, ser del centro y estar PLANIFICADO (no se prepara sobre activo/cerrado).
  const { data: destino } = await supabase
    .from('cursos_academicos')
    .select('id, centro_id, estado')
    .eq('id', curso_destino_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!destino) return fail('rollover.errors.destino_no_encontrado')
  if (destino.estado !== 'planificado') return fail('rollover.errors.destino_no_planificado')

  // Origen: el curso activo del centro.
  const { data: origenId } = await supabase.rpc('curso_activo_de_centro', {
    p_centro_id: destino.centro_id,
  })
  if (!origenId) return fail('rollover.errors.sin_curso_activo')

  // --- Aulas: copia aulas_curso origen → destino (salta las ya existentes). ---
  const { data: aulasOrigen, error: aoErr } = await supabase
    .from('aulas_curso')
    .select('aula_id, tramo_edad, capacidad')
    .eq('curso_academico_id', origenId)
  if (aoErr) {
    logger.warn('copiarConfigCurso aulas origen', aoErr.message)
    return fail('rollover.errors.copiar_fallo')
  }
  const { data: aulasDestino } = await supabase
    .from('aulas_curso')
    .select('aula_id')
    .eq('curso_academico_id', curso_destino_id)
  const yaAulas = new Set((aulasDestino ?? []).map((a) => a.aula_id))

  const nuevasAulas = (aulasOrigen ?? [])
    .filter((a) => !yaAulas.has(a.aula_id))
    .map((a) => ({
      centro_id: destino.centro_id,
      aula_id: a.aula_id,
      curso_academico_id: curso_destino_id,
      tramo_edad: a.tramo_edad,
      capacidad: a.capacidad,
    }))
  if (nuevasAulas.length > 0) {
    const { error } = await supabase.from('aulas_curso').insert(nuevasAulas)
    if (error) {
      logger.warn('copiarConfigCurso insert aulas', error.message)
      return fail('rollover.errors.copiar_fallo')
    }
  }

  // --- Personal (opcional): copia profes_aulas activos origen → destino. ---
  let personalCopiado = 0
  if (incluir_personal) {
    const { data: personalOrigen } = await supabase
      .from('profes_aulas')
      .select('profe_id, aula_id, es_profe_principal, tipo_personal_aula')
      .eq('curso_academico_id', origenId)
      .is('fecha_fin', null)
      .is('deleted_at', null)

    const { data: personalDestino } = await supabase
      .from('profes_aulas')
      .select('profe_id, aula_id')
      .eq('curso_academico_id', curso_destino_id)
      .is('deleted_at', null)
    const yaPersonal = new Set((personalDestino ?? []).map((p) => `${p.profe_id}:${p.aula_id}`))

    const nuevoPersonal = (personalOrigen ?? [])
      .filter((p) => !yaPersonal.has(`${p.profe_id}:${p.aula_id}`))
      .map((p) => ({
        profe_id: p.profe_id,
        aula_id: p.aula_id,
        curso_academico_id: curso_destino_id,
        es_profe_principal: p.es_profe_principal,
        tipo_personal_aula: p.tipo_personal_aula,
      }))
    if (nuevoPersonal.length > 0) {
      const { error } = await supabase.from('profes_aulas').insert(nuevoPersonal)
      if (error) {
        logger.warn('copiarConfigCurso insert personal', error.message)
        return fail('rollover.errors.copiar_fallo')
      }
    }
    personalCopiado = nuevoPersonal.length
  }

  revalidatePath('/[locale]/admin/pasar-de-curso', 'page')
  return ok({ aulasCopiadas: nuevasAulas.length, personalCopiado })
}
