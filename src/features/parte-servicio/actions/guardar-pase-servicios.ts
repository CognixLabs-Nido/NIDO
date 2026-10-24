'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { paseServiciosInputSchema, type PaseServiciosInput } from '../schemas/parte-servicio'
import { fail, ok, type ActionResult } from '../types'

/**
 * PR-12 — guarda el listado único: las casillas cambiadas de los tres servicios de un día, en un
 * solo upsert (`onConflict='nino_id,fecha,servicio'`). Si una fila falla, Postgres revierte todas.
 *
 * Con la sesión de quien lo rellena, que queda en `audit_log`. La RLS deja escribir a Dirección y
 * a cualquier profe del centro (`es_profe_en_centro`), y solo filas de un niño de ese centro.
 * `centro_id` lo fija igualmente el trigger desde el niño; se envía por el tipo Insert (NOT NULL).
 */
export async function guardarPaseServicios(
  input: PaseServiciosInput
): Promise<ActionResult<{ count: number }>> {
  const parsed = paseServiciosInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'parte_servicio.errors.guardar_fallo')
  }

  const supabase = await createClient()
  const rows = parsed.data.items.map((it) => ({
    centro_id: parsed.data.centro_id,
    nino_id: it.nino_id,
    fecha: parsed.data.fecha,
    servicio: it.servicio,
    presente: it.presente,
  }))

  const { error } = await supabase
    .from('parte_servicio_diario')
    .upsert(rows, { onConflict: 'nino_id,fecha,servicio' })

  if (error) {
    logger.warn('guardarPaseServicios', error.code, error.message)
    if (error.code === '42501') return fail('parte_servicio.errors.sin_permiso')
    // `congelar_si_mes_cerrado`: el parte de un mes cerrado no se edita.
    if (error.code === 'P0001' && error.message.includes('mes_cerrado_x')) {
      return fail('parte_servicio.errors.mes_cerrado')
    }
    return fail('parte_servicio.errors.guardar_fallo')
  }

  revalidatePath('/[locale]/teacher/servicios', 'page')
  return ok({ count: rows.length })
}
