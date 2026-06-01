'use server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { notificarEvento } from '../lib/notificar'
import { resolverCentroIdEvento, revalidarCalendario } from '../lib/server-helpers'
import { crearEventoSchema, type CrearEventoInput } from '../schemas/eventos'
import { fail, ok, type ActionResult } from '../types'

/**
 * Crea un evento (F7). admin (cualquier ámbito) o profe (solo ámbito aula sobre
 * su aula). `centro_id` resuelto server-side (no sentinel). Tras el INSERT, push
 * inmediato best-effort a la audiencia (reusa F5.5/F6-C). Si el push falla, el
 * evento ya está persistido.
 */
export async function crearEvento(
  input: CrearEventoInput
): Promise<ActionResult<{ evento_id: string }>> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('eventos.errors.no_autorizado')

  const result = await crearEventoCore(supabase, userId, input)
  if (result.success) revalidarCalendario()
  return result
}

/** Núcleo testeable: cliente + userId explícitos. Push best-effort al final. */
export async function crearEventoCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: CrearEventoInput
): Promise<ActionResult<{ evento_id: string }>> {
  const parsed = crearEventoSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'eventos.errors.creacion_fallo')
  }
  const d = parsed.data

  const centroResult = await resolverCentroIdEvento(
    supabase,
    userId,
    d.ambito,
    d.nino_id ?? null,
    d.aula_id ?? null
  )
  if (!centroResult.success) return centroResult
  const centroId = centroResult.data

  const { data: creado, error: insErr } = await supabase
    .from('eventos')
    .insert({
      centro_id: centroId,
      ambito: d.ambito,
      aula_id: d.ambito === 'aula' ? d.aula_id! : null,
      nino_id: d.ambito === 'nino' ? d.nino_id! : null,
      tipo: d.tipo,
      titulo: d.titulo,
      descripcion: d.descripcion ?? null,
      lugar: d.lugar ?? null,
      fecha: d.fecha,
      fecha_fin: d.fecha_fin ?? null,
      hora_inicio: d.hora_inicio ?? null,
      hora_fin: d.hora_fin ?? null,
      requiere_confirmacion: d.requiere_confirmacion,
      creado_por: userId,
    })
    .select('id')
    .single()

  if (insErr || !creado) {
    logger.warn('crearEvento: insert', insErr?.message)
    if (insErr?.code === '42501') return fail('eventos.errors.no_autorizado')
    return fail('eventos.errors.creacion_fallo')
  }

  await notificarEvento(userId, {
    id: creado.id,
    ambito: d.ambito,
    centro_id: centroId,
    aula_id: d.ambito === 'aula' ? d.aula_id! : null,
    nino_id: d.ambito === 'nino' ? d.nino_id! : null,
    titulo: d.titulo,
  })

  return ok({ evento_id: creado.id })
}
