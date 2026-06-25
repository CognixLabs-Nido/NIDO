'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { crearProspectoSchema, type CrearProspectoInput } from '../schemas/lista-espera'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-3: añade un prospecto a la lista de espera de un curso. `posicion` se
 * calcula al final de la cola (max + 1). `centro_id` lo deriva el trigger de BD
 * del curso; el insert va por el cliente autenticado → RLS exige admin del centro.
 */
export async function crearProspecto(
  input: CrearProspectoInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = crearProspectoSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'listaEspera.validation.invalid')
  const data = parsed.data

  const centroId = await getCentroActualId()
  if (!centroId) return fail('listaEspera.errors.sin_centro')

  const supabase = await createClient()

  // Siguiente posición en la cola del curso (sobre todas las filas, no solo en_espera,
  // para no colisionar con invitados/descartados que conservan su `posicion`).
  const { data: ultima } = await supabase
    .from('lista_espera')
    .select('posicion')
    .eq('curso_academico_id', data.curso_academico_id)
    .order('posicion', { ascending: false })
    .limit(1)
    .maybeSingle()
  const posicion = (ultima?.posicion ?? 0) + 1

  const { data: creado, error } = await supabase
    .from('lista_espera')
    .insert({
      centro_id: centroId, // lo sobrescribe el trigger; se pasa para satisfacer el tipo
      curso_academico_id: data.curso_academico_id,
      nombre_nino: data.nombre_nino,
      fecha_nacimiento: data.fecha_nacimiento,
      telefono_tutor: data.telefono_tutor,
      email_tutor: data.email_tutor,
      nota: data.nota,
      posicion,
    })
    .select('id')
    .single()
  if (error || !creado) {
    logger.warn('crearProspecto insert', error?.message)
    return fail('listaEspera.errors.crear_fallo')
  }

  revalidatePath('/[locale]/admin/admisiones', 'page')
  return ok({ id: creado.id })
}
