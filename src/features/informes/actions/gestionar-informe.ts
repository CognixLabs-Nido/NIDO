'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getCursoActivo } from '@/features/cursos/queries/get-cursos'

import { parseEstructura, respuestasToJson, todosValorados } from '../lib/estructura'
import {
  crearInformeSchema,
  despublicarInformeSchema,
  guardarBorradorSchema,
  publicarInformeSchema,
  type CrearInformeInput,
  type DespublicarInformeInput,
  type GuardarBorradorInput,
  type PublicarInformeInput,
} from '../schemas/informes'
import type { RespuestasInforme } from '../types'
import { fail, ok, type ActionResult } from '../types'

function revalidarInformesProfe(): void {
  revalidatePath('/[locale]/teacher/informes', 'page')
  revalidatePath('/[locale]/teacher/informes/[id]', 'page')
}

/**
 * Crea el informe de un niño para un período del curso activo, **congelando la
 * estructura** de la plantilla elegida (`estructura_snapshot`). Hay UN único
 * informe por (niño, curso, período): si ya existe, devuelve su id (no duplica;
 * la BD lo impide con el UNIQUE). Nace como **borrador**. Solo coordinadora/
 * profesora del aula del niño o admin (RLS `informes_evolucion_insert` →
 * `es_redactor_de_nino`). El `centro_id` y el snapshot se resuelven server-side.
 */
export async function crearInformeEvolucion(
  input: CrearInformeInput
): Promise<ActionResult<{ informe_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('informes.errors.no_autorizado')

  const parsed = crearInformeSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'informes.errors.creacion_fallo')
  }
  const { nino_id, periodo, plantilla_id } = parsed.data

  const centroId = await getCentroActualId()
  if (!centroId) return fail('informes.errors.no_autorizado')
  const curso = await getCursoActivo(centroId)
  if (!curso) return fail('informes.errors.sin_curso_activo')

  // ¿Ya existe el informe de la terna? → no se duplica, se reusa.
  const { data: existente } = await supabase
    .from('informes_evolucion')
    .select('id')
    .eq('nino_id', nino_id)
    .eq('curso_academico_id', curso.id)
    .eq('periodo', periodo)
    .maybeSingle()
  if (existente) {
    return ok({ informe_id: existente.id })
  }

  // Snapshot: copia congelada de la estructura de la plantilla (debe ser activa).
  const { data: plantilla, error: plErr } = await supabase
    .from('plantillas_informe')
    .select('id, estructura, estado, centro_id')
    .eq('id', plantilla_id)
    .maybeSingle()
  if (plErr) {
    logger.warn('crearInformeEvolucion: plantilla.select', plErr.message)
    return fail('informes.errors.creacion_fallo')
  }
  if (!plantilla || plantilla.estado !== 'activa') {
    return fail('informes.errors.plantilla_no_disponible')
  }

  const { data: creado, error } = await supabase
    .from('informes_evolucion')
    .insert({
      centro_id: centroId,
      nino_id,
      curso_academico_id: curso.id,
      periodo,
      plantilla_id: plantilla.id,
      estructura_snapshot: plantilla.estructura,
      estado: 'borrador',
      creado_por: user.id,
    })
    .select('id')
    .maybeSingle()

  if (error || !creado) {
    logger.warn('crearInformeEvolucion: insert', error?.message)
    if (error?.code === '42501') return fail('informes.errors.no_autorizado')
    // 23505 = UNIQUE de la terna (carrera): reusa el existente.
    if (error?.code === '23505') {
      const { data: row } = await supabase
        .from('informes_evolucion')
        .select('id')
        .eq('nino_id', nino_id)
        .eq('curso_academico_id', curso.id)
        .eq('periodo', periodo)
        .maybeSingle()
      if (row) return ok({ informe_id: row.id })
    }
    return fail('informes.errors.creacion_fallo')
  }

  revalidarInformesProfe()
  return ok({ informe_id: creado.id })
}

/**
 * Guarda el borrador del informe (respuestas + observaciones). Puede estar
 * **incompleto** (no exige todos los ítems). Solo redactor/admin (RLS UPDATE).
 */
export async function guardarBorradorInforme(
  input: GuardarBorradorInput
): Promise<ActionResult<{ informe_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('informes.errors.no_autorizado')

  const parsed = guardarBorradorSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'informes.errors.guardado_fallo')
  }
  const { informe_id, respuestas, observaciones_generales } = parsed.data

  const { data: upd, error } = await supabase
    .from('informes_evolucion')
    .update({
      respuestas: respuestasToJson(respuestas as RespuestasInforme),
      observaciones_generales: observaciones_generales ?? null,
    })
    .eq('id', informe_id)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('guardarBorradorInforme: update', error.message)
    if (error.code === '42501') return fail('informes.errors.no_autorizado')
    return fail('informes.errors.guardado_fallo')
  }
  if (!upd) return fail('informes.errors.no_autorizado')

  revalidarInformesProfe()
  return ok({ informe_id: upd.id })
}

/**
 * Publica el informe (borrador → publicado). **Exige que TODOS los ítems del
 * snapshot estén valorados** (Q9; comentarios y observaciones opcionales). Al
 * publicar por **primera vez** (`notificado_at IS NULL`) sella `notificado_at`
 * (canal de aviso a la familia, ADR-0025; el feed in-app de la familia lo
 * deriva en F9-3). En **re**publicaciones, `notificado_at` ya está sellado y NO
 * se reavisa (Q8). Solo redactor/admin (RLS UPDATE).
 */
export async function publicarInforme(
  input: PublicarInformeInput
): Promise<ActionResult<{ informe_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('informes.errors.no_autorizado')

  const parsed = publicarInformeSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'informes.errors.publicacion_fallo')
  }
  const { informe_id, respuestas, observaciones_generales } = parsed.data

  // Carga el snapshot (para validar "todos valorados") y el sello de notificación.
  const { data: informe, error: selErr } = await supabase
    .from('informes_evolucion')
    .select('id, estructura_snapshot, notificado_at')
    .eq('id', informe_id)
    .maybeSingle()
  if (selErr || !informe) return fail('informes.errors.no_encontrado')

  const snapshot = parseEstructura(informe.estructura_snapshot)
  if (!todosValorados(snapshot, respuestas as RespuestasInforme)) {
    return fail('informes.errors.faltan_valoraciones')
  }

  const ahora = new Date().toISOString()
  const { data: upd, error } = await supabase
    .from('informes_evolucion')
    .update({
      respuestas: respuestasToJson(respuestas as RespuestasInforme),
      observaciones_generales: observaciones_generales ?? null,
      estado: 'publicado',
      publicado_at: ahora,
      // Sella la PRIMERA notificación; en republicaciones se conserva (no re-avisa).
      notificado_at: informe.notificado_at ?? ahora,
    })
    .eq('id', informe_id)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('publicarInforme: update', error.message)
    if (error.code === '42501') return fail('informes.errors.no_autorizado')
    return fail('informes.errors.publicacion_fallo')
  }
  if (!upd) return fail('informes.errors.no_autorizado')

  revalidarInformesProfe()
  return ok({ informe_id: upd.id })
}

/**
 * Despublica el informe (publicado → borrador) para corregirlo. Deja de ser
 * visible para la familia. **`notificado_at` se conserva** (sello de "ya se
 * avisó"): al volver a publicar no se reavisa (Q8). Solo redactor/admin (RLS).
 */
export async function despublicarInforme(
  input: DespublicarInformeInput
): Promise<ActionResult<{ informe_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('informes.errors.no_autorizado')

  const parsed = despublicarInformeSchema.safeParse(input)
  if (!parsed.success) return fail('informes.errors.despublicacion_fallo')

  const { data: upd, error } = await supabase
    .from('informes_evolucion')
    .update({
      estado: 'borrador',
      publicado_at: null,
      // notificado_at NO se toca (Q8: republicar no re-avisa).
    })
    .eq('id', parsed.data.informe_id)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('despublicarInforme: update', error.message)
    if (error.code === '42501') return fail('informes.errors.no_autorizado')
    return fail('informes.errors.despublicacion_fallo')
  }
  if (!upd) return fail('informes.errors.no_autorizado')

  revalidarInformesProfe()
  return ok({ informe_id: upd.id })
}
