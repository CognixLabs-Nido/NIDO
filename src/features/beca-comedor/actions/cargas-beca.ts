'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { getCursoActivo } from '@/features/cursos/queries/get-cursos'
import { createClient } from '@/lib/supabase/server'
import { eurosACentimos } from '@/shared/lib/format-money'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { cargaBecaSchema, type CargaBecaInput } from '../schemas/beca-comedor'

const RUTA = '/[locale]/admin/cuotas'

type Supa = SupabaseClient<Database>

/** ¿El mes (año, mes) del centro está CERRADO? (fila en cierre_mensual → recibos congelados). */
async function mesEstaCerrado(
  supabase: Supa,
  centroId: string,
  anio: number,
  mes: number
): Promise<boolean> {
  const { data } = await supabase
    .from('cierre_mensual')
    .select('id')
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .maybeSingle()
  return data != null
}

/** Identidad de carga = (curso, año/mes CORRESPONDIENTE). Selecciona sus tramos normales. */
function tramosDeCarga(
  supabase: Supa,
  centroId: string,
  cursoId: string,
  anioCorr: number,
  mesCorr: number
) {
  return supabase
    .from('beca_comedor_tramo')
    .select('id, mes_aplicacion, anio_aplicacion')
    .eq('centro_id', centroId)
    .eq('curso_academico_id', cursoId)
    .eq('origen', 'normal')
    .eq('anio_correspondiente', anioCorr)
    .eq('mes_correspondiente', mesCorr)
}

/**
 * V2-3 — CREAR una carga: un importe único → un tramo `origen='normal' pendiente` para CADA
 * alumno con elegibilidad activa en el curso. Valida que el mes de aplicación esté ABIERTO
 * (D-P8) y que NO exista ya una carga para ese mes correspondiente (D-4: se rechaza, no
 * upsert). El motor (B2-1) la aplica al (RE)GENERAR el mes de aplicación.
 */
export async function crearCarga(input: CargaBecaInput): Promise<ActionResult<{ n: number }>> {
  const parsed = cargaBecaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'admin.cuotas.beca_comedor.errors.invalid')
  }
  const c = parsed.data

  const centroId = await getCentroActualId()
  if (!centroId) return fail('admin.cuotas.beca_comedor.errors.no_autorizado')
  const curso = await getCursoActivo(centroId)
  if (!curso) return fail('admin.cuotas.beca_comedor.errors.sin_curso')

  const supabase = await createClient()

  if (await mesEstaCerrado(supabase, centroId, c.anio_aplicacion, c.mes_aplicacion)) {
    return fail('admin.cuotas.beca_comedor.errors.mes_cerrado')
  }

  // ¿Ya hay carga para ese (año/mes correspondiente)? → rechazar (usar editar).
  const { data: existentes } = await tramosDeCarga(
    supabase,
    centroId,
    curso.id,
    c.anio_correspondiente,
    c.mes_correspondiente
  ).limit(1)
  if ((existentes ?? []).length > 0) return fail('admin.cuotas.beca_comedor.errors.ya_existe')

  // Elegibles activos del curso.
  const { data: elig } = await supabase
    .from('beca_comedor_elegibilidad')
    .select('nino_id')
    .eq('centro_id', centroId)
    .eq('curso_academico_id', curso.id)
    .eq('activa', true)
  const ninoIds = [...new Set((elig ?? []).map((e) => e.nino_id))]
  if (ninoIds.length === 0) return fail('admin.cuotas.beca_comedor.errors.sin_becados')

  const importe_centimos = eurosACentimos(c.importe_euros)
  const filas = ninoIds.map((nino_id) => ({
    centro_id: centroId,
    nino_id,
    curso_academico_id: curso.id,
    anio_correspondiente: c.anio_correspondiente,
    mes_correspondiente: c.mes_correspondiente,
    anio_aplicacion: c.anio_aplicacion,
    mes_aplicacion: c.mes_aplicacion,
    importe_centimos,
    origen: 'normal' as const,
    estado: 'pendiente' as const,
  }))

  const { error } = await supabase.from('beca_comedor_tramo').insert(filas)
  if (error) {
    logger.warn('crearCarga error', error.message)
    if (error.code === '42501') return fail('admin.cuotas.beca_comedor.errors.no_autorizado')
    if (error.code === '23505') return fail('admin.cuotas.beca_comedor.errors.ya_existe')
    return fail('admin.cuotas.beca_comedor.errors.save_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({ n: filas.length })
}

/**
 * V2-3 — EDITAR una carga: cambia SOLO importe y mes de aplicación de los tramos EXISTENTES
 * de ese mes correspondiente (no re-encuadra beneficiarios; para eso, borrar + recrear).
 * Exige que TANTO el mes de aplicación actual COMO el nuevo estén ABIERTOS (no toca el pasado).
 */
export async function editarCarga(input: CargaBecaInput): Promise<ActionResult<{ n: number }>> {
  const parsed = cargaBecaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'admin.cuotas.beca_comedor.errors.invalid')
  }
  const c = parsed.data

  const centroId = await getCentroActualId()
  if (!centroId) return fail('admin.cuotas.beca_comedor.errors.no_autorizado')
  const curso = await getCursoActivo(centroId)
  if (!curso) return fail('admin.cuotas.beca_comedor.errors.sin_curso')

  const supabase = await createClient()

  const { data: tramos } = await tramosDeCarga(
    supabase,
    centroId,
    curso.id,
    c.anio_correspondiente,
    c.mes_correspondiente
  )
  if ((tramos ?? []).length === 0) return fail('admin.cuotas.beca_comedor.errors.no_existe')

  // El mes de aplicación ACTUAL (compartido por la carga) y el NUEVO deben estar abiertos.
  const actual = tramos![0]!
  if (await mesEstaCerrado(supabase, centroId, actual.anio_aplicacion, actual.mes_aplicacion)) {
    return fail('admin.cuotas.beca_comedor.errors.mes_cerrado')
  }
  if (await mesEstaCerrado(supabase, centroId, c.anio_aplicacion, c.mes_aplicacion)) {
    return fail('admin.cuotas.beca_comedor.errors.mes_cerrado')
  }

  const { error } = await supabase
    .from('beca_comedor_tramo')
    .update({
      importe_centimos: eurosACentimos(c.importe_euros),
      anio_aplicacion: c.anio_aplicacion,
      mes_aplicacion: c.mes_aplicacion,
    })
    .eq('centro_id', centroId)
    .eq('curso_academico_id', curso.id)
    .eq('origen', 'normal')
    .eq('anio_correspondiente', c.anio_correspondiente)
    .eq('mes_correspondiente', c.mes_correspondiente)

  if (error) {
    logger.warn('editarCarga error', error.message)
    if (error.code === '42501') return fail('admin.cuotas.beca_comedor.errors.no_autorizado')
    return fail('admin.cuotas.beca_comedor.errors.save_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({ n: (tramos ?? []).length })
}

/**
 * V2-3 — BORRAR una carga en bloque: elimina todos los tramos de ese mes correspondiente.
 * Solo si su mes de aplicación sigue ABIERTO (no toca recibos congelados).
 */
export async function borrarCarga(input: {
  anio_correspondiente: number
  mes_correspondiente: number
}): Promise<ActionResult<{ n: number }>> {
  const centroId = await getCentroActualId()
  if (!centroId) return fail('admin.cuotas.beca_comedor.errors.no_autorizado')
  const curso = await getCursoActivo(centroId)
  if (!curso) return fail('admin.cuotas.beca_comedor.errors.sin_curso')

  const supabase = await createClient()

  const { data: tramos } = await tramosDeCarga(
    supabase,
    centroId,
    curso.id,
    input.anio_correspondiente,
    input.mes_correspondiente
  )
  if ((tramos ?? []).length === 0) return fail('admin.cuotas.beca_comedor.errors.no_existe')

  const actual = tramos![0]!
  if (await mesEstaCerrado(supabase, centroId, actual.anio_aplicacion, actual.mes_aplicacion)) {
    return fail('admin.cuotas.beca_comedor.errors.mes_cerrado')
  }

  const { error } = await supabase
    .from('beca_comedor_tramo')
    .delete()
    .eq('centro_id', centroId)
    .eq('curso_academico_id', curso.id)
    .eq('origen', 'normal')
    .eq('anio_correspondiente', input.anio_correspondiente)
    .eq('mes_correspondiente', input.mes_correspondiente)

  if (error) {
    logger.warn('borrarCarga error', error.message)
    if (error.code === '42501') return fail('admin.cuotas.beca_comedor.errors.no_autorizado')
    return fail('admin.cuotas.beca_comedor.errors.delete_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({ n: (tramos ?? []).length })
}
