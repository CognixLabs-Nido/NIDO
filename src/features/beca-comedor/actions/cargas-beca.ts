'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { getCursoActivo } from '@/features/cursos/queries/get-cursos'
import { createClient } from '@/lib/supabase/server'
import { eurosACentimos } from '@/shared/lib/format-money'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { planGuardarCarga, type FilaCarga, type PlanCarga } from '../lib/cargas'
import { cargaBecaSchema, type CargaBecaInput } from '../schemas/beca-comedor'

const RUTA = '/[locale]/admin/cuotas'
/** HINT de `beca_tramo_proteger`: el tramo ya está descontado en un recibo validado. */
const BECA_APLICADA = 'beca_aplicada'

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
    .select('id, nino_id, importe_centimos, estado, mes_aplicacion, anio_aplicacion')
    .eq('centro_id', centroId)
    .eq('curso_academico_id', cursoId)
    .eq('origen', 'normal')
    .eq('anio_correspondiente', anioCorr)
    .eq('mes_correspondiente', mesCorr)
}

/** Alumnos con elegibilidad ACTIVA en el curso: los únicos que pueden recibir un tramo nuevo. */
async function becadosDelCurso(supabase: Supa, centroId: string, cursoId: string) {
  const { data } = await supabase
    .from('beca_comedor_elegibilidad')
    .select('nino_id')
    .eq('centro_id', centroId)
    .eq('curso_academico_id', cursoId)
    .eq('activa', true)
  return new Set((data ?? []).map((e) => e.nino_id))
}

function filasDe(c: CargaBecaInput): FilaCarga[] {
  return c.importes.map((f) => ({
    nino_id: f.nino_id,
    importe_centimos: f.importe_euros == null ? null : eurosACentimos(f.importe_euros),
  }))
}

/** Traduce un error de escritura de tramos a la clave que lee la directora. */
function errorDeEscritura(
  error: { code?: string; hint?: string; message: string },
  donde: string,
  generico: string
): string {
  logger.warn(`${donde} error`, error.message)
  if (error.code === '42501') return 'admin.cuotas.beca_comedor.errors.no_autorizado'
  if (error.code === '23505') return 'admin.cuotas.beca_comedor.errors.ya_existe'
  // PR-5: algún tramo ya está descontado en un recibo validado (trigger beca_tramo_proteger).
  if (error.hint === BECA_APLICADA) return 'admin.cuotas.beca_comedor.errors.carga_aplicada'
  return generico
}

/**
 * Escribe el plan: tramos nuevos, cambios de importe, borrados y, si cambia, el mes de
 * aplicación de los pendientes. No es atómico, pero el plan es idempotente: si algo falla a
 * medias, guardar otra vez parte del estado real y termina el trabajo.
 */
async function escribirPlan(
  supabase: Supa,
  plan: Extract<PlanCarga, { ok: true }>,
  base: {
    centroId: string
    cursoId: string
    c: CargaBecaInput
  },
  donde: string
): Promise<string | null> {
  const { centroId, cursoId, c } = base
  const generico = 'admin.cuotas.beca_comedor.errors.save_failed'
  if (plan.borrar.length > 0) {
    const { error } = await supabase.from('beca_comedor_tramo').delete().in('id', plan.borrar)
    if (error) return errorDeEscritura(error, donde, generico)
  }
  for (const u of plan.actualizar) {
    const { error } = await supabase
      .from('beca_comedor_tramo')
      .update({ importe_centimos: u.importe_centimos })
      .in('id', u.ids)
    if (error) return errorDeEscritura(error, donde, generico)
  }
  if (plan.mover.length > 0) {
    const { error } = await supabase
      .from('beca_comedor_tramo')
      .update({ anio_aplicacion: c.anio_aplicacion, mes_aplicacion: c.mes_aplicacion })
      .in('id', plan.mover)
    if (error) return errorDeEscritura(error, donde, generico)
  }
  if (plan.insertar.length > 0) {
    const { error } = await supabase.from('beca_comedor_tramo').insert(
      plan.insertar.map((f) => ({
        centro_id: centroId,
        nino_id: f.nino_id,
        curso_academico_id: cursoId,
        anio_correspondiente: c.anio_correspondiente,
        mes_correspondiente: c.mes_correspondiente,
        anio_aplicacion: c.anio_aplicacion,
        mes_aplicacion: c.mes_aplicacion,
        importe_centimos: f.importe_centimos,
        origen: 'normal' as const,
        estado: 'pendiente' as const,
      }))
    )
    if (error) return errorDeEscritura(error, donde, generico)
  }
  return null
}

/**
 * V2-3 / PR-10 — CREAR una carga: un tramo `origen='normal' pendiente` por cada becado con
 * importe, con el importe de ese alumno. Valida que el mes de aplicación esté ABIERTO (D-P8),
 * que NO exista ya una carga para ese mes correspondiente (D-4: se rechaza, no upsert) y que
 * cada alumno con importe tenga la beca activa. El motor (B2-1) la aplica al (RE)GENERAR el mes
 * de aplicación.
 */
export async function crearCarga(
  input: CargaBecaInput,
  centroId: string
): Promise<ActionResult<{ n: number }>> {
  const parsed = cargaBecaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'admin.cuotas.beca_comedor.errors.invalid')
  }
  const c = parsed.data

  // Centro EXPLÍCITO de la página (multicentro · Fase 1): admin en él, no el de la cookie.
  const supabase = await createClient()
  if (!(await usuarioAdminEn(supabase, centroId))) {
    return fail('admin.cuotas.beca_comedor.errors.no_autorizado')
  }
  const curso = await getCursoActivo(centroId)
  if (!curso) return fail('admin.cuotas.beca_comedor.errors.sin_curso')

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

  const plan = planGuardarCarga([], filasDe(c), false)
  if (!plan.ok) return fail('admin.cuotas.beca_comedor.errors.carga_aplicada')
  if (plan.insertar.length === 0) return fail('admin.cuotas.beca_comedor.errors.sin_importes')
  const becados = await becadosDelCurso(supabase, centroId, curso.id)
  if (plan.insertar.some((f) => !becados.has(f.nino_id))) {
    return fail('admin.cuotas.beca_comedor.errors.no_becado')
  }

  const err = await escribirPlan(supabase, plan, { centroId, cursoId: curso.id, c }, 'crearCarga')
  if (err) return fail(err)

  revalidatePath(RUTA, 'page')
  return ok({ n: plan.insertar.length })
}

/**
 * V2-3 / PR-10 — EDITAR una carga: el importe de cada alumno y el mes de aplicación. Un becado
 * que no estaba en la carga (marcado después) recibe su tramo; uno sin importe lo pierde. Los
 * tramos ya descontados en un recibo validado no se tocan, y con alguno así la carga no cambia
 * de mes. Exige que TANTO el mes de aplicación actual COMO el nuevo estén ABIERTOS.
 */
export async function editarCarga(
  input: CargaBecaInput,
  centroId: string
): Promise<ActionResult<{ n: number }>> {
  const parsed = cargaBecaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'admin.cuotas.beca_comedor.errors.invalid')
  }
  const c = parsed.data

  // Centro EXPLÍCITO de la página (multicentro · Fase 1): admin en él, no el de la cookie.
  const supabase = await createClient()
  if (!(await usuarioAdminEn(supabase, centroId))) {
    return fail('admin.cuotas.beca_comedor.errors.no_autorizado')
  }
  const curso = await getCursoActivo(centroId)
  if (!curso) return fail('admin.cuotas.beca_comedor.errors.sin_curso')

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

  const cambiaAplicacion =
    actual.anio_aplicacion !== c.anio_aplicacion || actual.mes_aplicacion !== c.mes_aplicacion
  const plan = planGuardarCarga(tramos ?? [], filasDe(c), cambiaAplicacion)
  if (!plan.ok) return fail('admin.cuotas.beca_comedor.errors.carga_aplicada')
  if (plan.insertar.length > 0) {
    const becados = await becadosDelCurso(supabase, centroId, curso.id)
    if (plan.insertar.some((f) => !becados.has(f.nino_id))) {
      return fail('admin.cuotas.beca_comedor.errors.no_becado')
    }
  }

  const err = await escribirPlan(supabase, plan, { centroId, cursoId: curso.id, c }, 'editarCarga')
  if (err) return fail(err)

  revalidatePath(RUTA, 'page')
  return ok({ n: plan.insertar.length })
}

/**
 * V2-3 — BORRAR una carga en bloque: elimina todos los tramos de ese mes correspondiente.
 * Solo si su mes de aplicación sigue ABIERTO (no toca recibos congelados).
 */
export async function borrarCarga(
  input: {
    anio_correspondiente: number
    mes_correspondiente: number
  },
  centroId: string
): Promise<ActionResult<{ n: number }>> {
  // Centro EXPLÍCITO de la página (multicentro · Fase 1): admin en él, no el de la cookie.
  const supabase = await createClient()
  if (!(await usuarioAdminEn(supabase, centroId))) {
    return fail('admin.cuotas.beca_comedor.errors.no_autorizado')
  }
  const curso = await getCursoActivo(centroId)
  if (!curso) return fail('admin.cuotas.beca_comedor.errors.sin_curso')

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
    // PR-5: algún tramo ya está descontado en un recibo validado (trigger beca_tramo_proteger).
    if (error.hint === BECA_APLICADA) return fail('admin.cuotas.beca_comedor.errors.carga_aplicada')
    return fail('admin.cuotas.beca_comedor.errors.delete_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({ n: (tramos ?? []).length })
}
