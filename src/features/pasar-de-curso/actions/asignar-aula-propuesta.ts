'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'

import { asignarAulaPropuestaCore } from '../lib/mutaciones-rollover'
import { asignarAulaPropuestaSchema, type AsignarAulaPropuestaInput } from '../schemas/rollover'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-2: asigna (o reasigna) a un niño una sala concreta del curso destino en la
 * propuesta. Resuelve los casos "requiere elección" (≥2 salas o sin fecha) y los
 * overrides manuales. Opera SOLO sobre `pendiente`. F-3-A: si el niño estaba en
 * "Finaliza", esta acción lo saca de Finaliza (exclusión mutua). No toca activas ni de baja.
 */
export async function asignarAulaPropuesta(
  input: AsignarAulaPropuestaInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = asignarAulaPropuestaSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'rollover.validation.invalid')
  const { curso_destino_id, nino_id, aula_id } = parsed.data

  const supabase = await createClient()
  const res = await asignarAulaPropuestaCore(supabase, curso_destino_id, nino_id, aula_id)
  if (!res.success) return res

  revalidatePath('/[locale]/admin/pasar-de-curso', 'page')
  return ok(res.data)
}
