'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fechaEnCohorte } from '../../aulas/schemas/aula'
import { crearNinoCompletoSchema, type CrearNinoCompletoInput } from '../schemas/nino'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * B12: crea un niño + (opcional) info médica cifrada + matrícula en aula.
 *
 * No tenemos transacciones explícitas desde el cliente Supabase. Ejecutamos
 * las 3 operaciones en orden; si falla la médica o la matrícula, deshacemos
 * los pasos previos a mano. RLS asegura que solo admin puede ejecutarlas.
 */
export async function crearNinoCompleto(
  centroId: string,
  input: CrearNinoCompletoInput
): Promise<ActionResult<{ ninoId: string; matriculaId: string }>> {
  const parsed = crearNinoCompletoSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'nino.validation.invalid')
  }

  const supabase = await createClient()

  // F11-H: la matrícula operativa va al curso ACTIVO del centro.
  const { data: cursoActivoId } = await supabase.rpc('curso_activo_de_centro', {
    p_centro_id: centroId,
  })
  if (!cursoActivoId) return fail('nino.errors.sin_curso_activo')

  // Config del aula en ese curso (aulas_curso): valida que el aula existe en el
  // curso y aporta el tramo de edad para la verificación de cohorte.
  const { data: aulaCurso, error: aulaErr } = await supabase
    .from('aulas_curso')
    .select('tramo_edad, aula:aulas!inner(centro_id, deleted_at)')
    .eq('aula_id', parsed.data.aula_id)
    .eq('curso_academico_id', cursoActivoId)
    .maybeSingle()

  const aula = aulaCurso as {
    tramo_edad: number[]
    aula: { centro_id: string; deleted_at: string | null } | null
  } | null
  if (aulaErr || !aula || !aula.aula || aula.aula.deleted_at !== null) {
    logger.warn('crearNinoCompleto aula lookup error', aulaErr?.message)
    return fail('nino.errors.aula_no_encontrada')
  }
  if (aula.aula.centro_id !== centroId) {
    return fail('nino.errors.aula_de_otro_centro')
  }

  const dentroDeCohorte = fechaEnCohorte(parsed.data.datos.fecha_nacimiento, aula.tramo_edad)
  if (!dentroDeCohorte && !parsed.data.confirmar_fuera_cohorte) {
    return fail('nino.validation.fuera_de_cohorte')
  }

  // 1) Insert nino
  const { data: nino, error: ninoErr } = await supabase
    .from('ninos')
    .insert({ centro_id: centroId, ...parsed.data.datos })
    .select('id')
    .single()
  if (ninoErr || !nino) {
    logger.warn('crearNinoCompleto nino insert error', ninoErr?.message)
    return fail('nino.errors.create_failed')
  }

  // 2) Insert info médica via función SECURITY DEFINER cifrada (si hay datos).
  if (parsed.data.medica) {
    const m = parsed.data.medica
    // El tipo generado de Supabase declara los args como string no nullable,
    // pero la función SQL los acepta NULL (contrato "NULL = preservar campo").
    // Mantenemos el null en runtime y silenciamos el typecheck con anotación.
    const rpcArgs = {
      p_nino_id: nino.id,
      p_alergias_graves: m.alergias_graves ?? null,
      p_notas_emergencia: m.notas_emergencia ?? null,
      p_medicacion_habitual: m.medicacion_habitual ?? null,
      p_alergias_leves: m.alergias_leves ?? null,
      p_medico_familia: m.medico_familia ?? null,
      p_telefono_emergencia: m.telefono_emergencia ?? null,
    } as unknown as {
      p_nino_id: string
      p_alergias_graves: string
      p_notas_emergencia: string
      p_medicacion_habitual: string
      p_alergias_leves: string
      p_medico_familia: string
      p_telefono_emergencia: string
    }
    const { error: medErr } = await supabase.rpc('set_info_medica_emergencia_cifrada', rpcArgs)
    if (medErr) {
      logger.warn('crearNinoCompleto medica error', medErr.message)
      // Rollback manual: soft-delete del niño (no podemos hard-delete por RESTRICT en info_medica).
      await supabase
        .from('ninos')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', nino.id)
      return fail('medico.error.cifrado_no_configurado')
    }
  }

  // 3) Insert matrícula
  const { data: matricula, error: matErr } = await supabase
    .from('matriculas')
    .insert({
      nino_id: nino.id,
      aula_id: parsed.data.aula_id,
      curso_academico_id: cursoActivoId,
      fecha_alta: new Date().toISOString().slice(0, 10),
    })
    .select('id')
    .single()
  if (matErr || !matricula) {
    logger.warn('crearNinoCompleto matricula error', matErr?.message)
    // Soft delete del nino (deja info médica huérfana pero esto solo pasa en error).
    await supabase.from('ninos').update({ deleted_at: new Date().toISOString() }).eq('id', nino.id)
    return fail('matricula.errors.create_failed')
  }

  revalidatePath('/[locale]/admin/ninos', 'page')
  return ok({ ninoId: nino.id, matriculaId: matricula.id })
}
