'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getCursoActivo } from '@/features/cursos/queries/get-cursos'

import {
  abrirCampanaSchema,
  cambiarEstadoCampanaSchema,
  editarFechaCampanaSchema,
  type AbrirCampanaInput,
  type CambiarEstadoCampanaInput,
  type EditarFechaCampanaInput,
} from '../schemas/campanas-informe'
import { fail, ok, type ActionResult } from '../types'

const E = 'informes.campana.errors'

function revalidarCampanas(): void {
  revalidatePath('/[locale]/admin/informes/campanas', 'page')
}

/**
 * Abre una campaña para el (curso activo, período) elegido. Solo **admin** (RLS
 * `campanas_informe_insert` → `es_admin` + `created_by=auth.uid()`). La terna es
 * UNIQUE: si ya existe una campaña de ese período/curso, **se reabre y se
 * actualiza la fecha** en vez de duplicar (Q1). El curso lo fija el server (Q7):
 * la dirección no lo elige.
 */
export async function abrirCampanaInforme(
  input: AbrirCampanaInput
): Promise<ActionResult<{ campana_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail(`${E}.no_autorizado`)

  const parsed = abrirCampanaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? `${E}.creacion_fallo`)
  }

  const centroId = await getCentroActualId()
  if (!centroId) return fail(`${E}.no_autorizado`)
  const curso = await getCursoActivo(centroId)
  if (!curso) return fail(`${E}.sin_curso_activo`)

  // ¿Existe ya una campaña de esta terna? (UNIQUE centro/curso/período).
  const { data: existente } = await supabase
    .from('campanas_informe')
    .select('id')
    .eq('centro_id', centroId)
    .eq('curso_academico_id', curso.id)
    .eq('periodo', parsed.data.periodo)
    .maybeSingle()

  if (existente) {
    // Reabrir + actualizar fecha (no duplicar).
    const { data: upd, error } = await supabase
      .from('campanas_informe')
      .update({ estado: 'abierta', fecha_limite: parsed.data.fecha_limite })
      .eq('id', existente.id)
      .select('id')
      .maybeSingle()
    if (error || !upd) {
      logger.warn('abrirCampanaInforme: reabrir', error?.message)
      if (error?.code === '42501') return fail(`${E}.no_autorizado`)
      return fail(`${E}.creacion_fallo`)
    }
    revalidarCampanas()
    return ok({ campana_id: upd.id })
  }

  const { data: creada, error } = await supabase
    .from('campanas_informe')
    .insert({
      centro_id: centroId,
      curso_academico_id: curso.id,
      periodo: parsed.data.periodo,
      fecha_limite: parsed.data.fecha_limite,
      estado: 'abierta',
      created_by: user.id,
    })
    .select('id')
    .maybeSingle()

  if (error || !creada) {
    logger.warn('abrirCampanaInforme: insert', error?.message)
    if (error?.code === '42501') return fail(`${E}.no_autorizado`)
    if (error?.code === '23505') return fail('informes.campana.validation.campana_duplicada')
    return fail(`${E}.creacion_fallo`)
  }

  revalidarCampanas()
  return ok({ campana_id: creada.id })
}

/**
 * Edita la fecha límite de una campaña. Solo **admin** (RLS
 * `campanas_informe_update`). El período/curso no cambia (es la terna UNIQUE).
 */
export async function editarFechaCampana(
  input: EditarFechaCampanaInput
): Promise<ActionResult<{ campana_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail(`${E}.no_autorizado`)

  const parsed = editarFechaCampanaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? `${E}.edicion_fallo`)
  }

  const { data: upd, error } = await supabase
    .from('campanas_informe')
    .update({ fecha_limite: parsed.data.fecha_limite })
    .eq('id', parsed.data.campana_id)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('editarFechaCampana: update', error.message)
    if (error.code === '42501') return fail(`${E}.no_autorizado`)
    return fail(`${E}.edicion_fallo`)
  }
  if (!upd) return fail(`${E}.no_autorizado`)

  revalidarCampanas()
  return ok({ campana_id: upd.id })
}

/**
 * Cierra (`cerrada`) o reabre (`abierta`) una campaña. Cerrar **no toca los
 * informes** (capa-no-puerta): solo apaga el aviso de pendientes; el seguimiento
 * sigue consultable como histórico. Reversible (Q4). Solo **admin** (RLS
 * `campanas_informe_update`).
 */
export async function cambiarEstadoCampana(
  input: CambiarEstadoCampanaInput
): Promise<ActionResult<{ campana_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail(`${E}.no_autorizado`)

  const parsed = cambiarEstadoCampanaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? `${E}.cierre_fallo`)
  }

  const { data: upd, error } = await supabase
    .from('campanas_informe')
    .update({ estado: parsed.data.estado })
    .eq('id', parsed.data.campana_id)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('cambiarEstadoCampana: update', error.message)
    if (error.code === '42501') return fail(`${E}.no_autorizado`)
    return fail(`${E}.cierre_fallo`)
  }
  if (!upd) return fail(`${E}.no_autorizado`)

  revalidarCampanas()
  return ok({ campana_id: upd.id })
}
