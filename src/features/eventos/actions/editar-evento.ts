'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { huboCambioMaterial } from '../lib/cambios'
import { notificarEdicionEvento } from '../lib/notificar'
import { revalidarCalendario } from '../lib/server-helpers'
import { editarEventoSchema, type EditarEventoInput } from '../schemas/eventos'
import { fail, ok, type ActionResult } from '../types'

/**
 * Edita el contenido y fechas de un evento (no su ámbito/audiencia, D-edición).
 * RLS `eventos_update` autoriza al autor o a un admin (D8). Solo re-notifica
 * (best-effort) si cambió algún campo **material** (fecha/hora/lugar): una
 * corrección de título/descripción no molesta a las familias. El gotcha "USING
 * falso → 0 filas": `.select().maybeSingle()` + `!updated` = RLS rechazó.
 */
export async function editarEvento(
  input: EditarEventoInput
): Promise<ActionResult<{ evento_id: string }>> {
  const parsed = editarEventoSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'eventos.errors.edicion_fallo')
  }
  const d = parsed.data

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('eventos.errors.no_autorizado')

  // Estado material previo, para decidir si re-notificar (lo leemos antes del
  // UPDATE; el autor/admin tiene RLS de SELECT sobre su propio evento).
  const { data: previo } = await supabase
    .from('eventos')
    .select('fecha, fecha_fin, hora_inicio, hora_fin, lugar')
    .eq('id', d.evento_id)
    .maybeSingle()

  const { data: updated, error } = await supabase
    .from('eventos')
    .update({
      tipo: d.tipo,
      titulo: d.titulo,
      descripcion: d.descripcion ?? null,
      lugar: d.lugar ?? null,
      fecha: d.fecha,
      fecha_fin: d.fecha_fin ?? null,
      hora_inicio: d.hora_inicio ?? null,
      hora_fin: d.hora_fin ?? null,
      requiere_confirmacion: d.requiere_confirmacion,
    })
    .eq('id', d.evento_id)
    .select('id, ambito, centro_id, aula_id, nino_id, titulo')
    .maybeSingle()

  if (error) {
    logger.warn('editarEvento: update', error.message)
    if (error.code === '42501') return fail('eventos.errors.no_autorizado')
    return fail('eventos.errors.edicion_fallo')
  }
  if (!updated) return fail('eventos.errors.no_autorizado')

  const cambioMaterial =
    !previo ||
    huboCambioMaterial(previo, {
      fecha: d.fecha,
      fecha_fin: d.fecha_fin ?? null,
      hora_inicio: d.hora_inicio ?? null,
      hora_fin: d.hora_fin ?? null,
      lugar: d.lugar ?? null,
    })

  if (cambioMaterial) {
    await notificarEdicionEvento(userId, {
      id: updated.id,
      ambito: updated.ambito,
      centro_id: updated.centro_id,
      aula_id: updated.aula_id,
      nino_id: updated.nino_id,
      titulo: updated.titulo,
    })
  }

  revalidarCalendario()
  return ok({ evento_id: updated.id })
}
