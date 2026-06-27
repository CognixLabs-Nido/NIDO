'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'
import { invitarTutor2AlValidar } from '../lib/invitar-tutor-2'

const matriculaIdSchema = z.string().uuid()

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
 * RLS de `matriculas` gobierna el acceso (solo admin del centro actualiza). El
 * `.eq('estado','lista')` + `.maybeSingle()` da idempotencia (patrón "USING falso →
 * 0 filas"): si ya estaba activa, sigue en pendiente, o no existe, `data` es null.
 */
export async function activarMatricula(matriculaId: string): Promise<ActionResult<{ id: string }>> {
  const parsed = matriculaIdSchema.safeParse(matriculaId)
  if (!parsed.success) return fail('matricula.validation.invalid')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('matriculas')
    .update({ estado: 'activa' })
    .eq('id', parsed.data)
    .eq('estado', 'lista')
    .select('id, nino_id')
    .maybeSingle()

  if (error) {
    logger.warn('activarMatricula', error.message)
    if (error.code === '42501') return fail('matricula.errors.no_autorizado')
    return fail('matricula.errors.activar_failed')
  }
  if (!data) return fail('matricula.errors.no_lista')

  // Decisión D-a: al validar el alta, invitar al tutor 2 con el email del wizard
  // (best-effort, idempotente; un fallo no revierte la activación ya hecha).
  await invitarTutor2AlValidar(supabase, data.nino_id)

  revalidatePath('/[locale]/admin/ninos', 'page')
  return ok({ id: data.id })
}
