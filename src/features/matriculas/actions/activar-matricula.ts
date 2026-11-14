'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'
import { invitarTutor2AlValidar } from '../lib/invitar-tutor-2'

const matriculaIdSchema = z.string().uuid()
/** Un día del calendario (`AAAA-MM-DD`), el que sale de un `<input type="date">`. */
const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * Pieza 2b/3c — "Activar matrícula" (dirección). Flipea una matrícula
 * `estado='lista'` → `'activa'`, momento en el que (gracias al endurecimiento de
 * la Pieza 2a) el niño entra en las lecturas operativas y se abre el panel del tutor.
 *
 * **Guard P3c (DEC-B):** solo activa una matrícula en `'lista'` — es decir, una que
 * el tutor YA finalizó en el wizard (`marcar_matricula_lista`). Un esqueleto a medias
 * en `'pendiente'` (el tutor aún no acabó) NO es activable. La cola de validación de
 * la dirección = matrículas en `'lista'`.
 *
 * **Fase 8a:** validar es también decir qué día empieza a venir el niño (la fecha de
 * incorporación), que decide desde qué mes se le cobra. Lo hace `validar_alta`: solo
 * Dirección del centro (42501), con la fecha (HINT `falta_fecha_incorporacion`), y solo
 * una matrícula `'lista'`; si no lo estaba devuelve NULL (`matricula.errors.no_lista`).
 */
export async function activarMatricula(
  matriculaId: string,
  fechaIncorporacion: string
): Promise<ActionResult<{ id: string }>> {
  const parsed = matriculaIdSchema.safeParse(matriculaId)
  if (!parsed.success) return fail('matricula.validation.invalid')
  // Fase 8a: sin el día en que empieza a venir no se valida (decide desde cuándo se le cobra).
  const fecha = fechaSchema.safeParse(fechaIncorporacion)
  if (!fecha.success) return fail('matricula.validation.fecha_incorporacion_requerida')

  const supabase = await createClient()
  // `validar_alta` (20270120120000) pone la fecha y activa, las dos cosas o ninguna. Devuelve la
  // matrícula, o NULL si no estaba 'lista' (ya activa, a medias o borrada).
  const { data, error } = await supabase.rpc('validar_alta', {
    p_matricula_id: parsed.data,
    p_fecha_incorporacion: fecha.data,
  })

  if (error) {
    logger.warn('activarMatricula', error.message)
    if (error.code === '42501') return fail('matricula.errors.no_autorizado')
    if (error.hint === 'falta_fecha_incorporacion')
      return fail('matricula.validation.fecha_incorporacion_requerida')
    return fail('matricula.errors.activar_failed')
  }
  if (!data) return fail('matricula.errors.no_lista')

  const { data: m } = await supabase
    .from('matriculas')
    .select('nino_id')
    .eq('id', data)
    .maybeSingle()
  // Decisión D-a: al validar el alta, invitar al tutor 2 con el email del wizard
  // (best-effort, idempotente; un fallo no revierte la activación ya hecha).
  if (m) await invitarTutor2AlValidar(supabase, m.nino_id)

  revalidatePath('/[locale]/admin/ninos', 'page')
  revalidatePath('/[locale]/admin/altas', 'page')
  return ok({ id: data })
}
