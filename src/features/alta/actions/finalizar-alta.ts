'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { modoFirmaDocumento } from '@/features/documentos-centro/lib/firmar-documentos'
import { comprobarAlta, faltanDeHint, type BloqueAlta } from '../lib/gate-alta'

import { fail, ok } from '../../centros/types'
import { falloDeLectura } from '@/shared/lib/frontera-lectura'

/** Resultado de `finalizarAlta`: en fallo por completitud viaja `faltan` (bloques). */
export type FinalizarAltaResult =
  | { success: true; data: { id: string } }
  | { success: false; error: string; faltan?: BloqueAlta[] }

const ninoIdSchema = z.string().uuid()

/**
 * Pieza 3c — se cierra el alta: la matrícula pasa de `'pendiente'` a `'lista'` (cola de validación
 * de la dirección) vía la RPC `marcar_matricula_lista`.
 *
 * Desde la 10b-2 la familia cierra al FIRMAR la ficha (`firmarFichaNino`): firmar es finalizar. Esta
 * acción queda para el alta en papel, que la Dirección termina con «Finalizar» hasta que la 10b-3
 * traiga la firma en papel de la ficha con el tutor que firmó (`altas-serie.md`, «La firma en papel
 * de la ficha va con la 10b-3»).
 *
 * ANTES corre el gate de completitud (`comprobarAlta`), con las señales de la base; si falta algo,
 * devuelve `faltan` para el checklist. La RPC sigue siendo el backstop de las llamadas directas.
 *
 * Idempotente: re-finalizar estando ya `'lista'` es no-op en la RPC (devuelve null) y se trata como
 * éxito.
 */
export async function finalizarAlta(ninoId: string): Promise<FinalizarAltaResult> {
  try {
    const parsed = ninoIdSchema.safeParse(ninoId)
    if (!parsed.success) return fail('alta.errors.finalizar_fallo')
    const id = parsed.data

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return fail('alta.errors.no_autorizado')

    const modo = await modoFirmaDocumento(supabase, id, user.id)
    if (!modo) return fail('alta.errors.no_autorizado')

    const gate = await comprobarAlta(supabase, id, user.id, modo === 'presencial')
    if (!gate.ok) return fail('alta.errors.finalizar_fallo')
    if (gate.faltan.length > 0) {
      return { success: false, error: 'alta.errors.incompleto', faltan: gate.faltan }
    }

    // Gate OK → finalizar. `null` (no había 'pendiente') = idempotente: ya estaba.
    const { error } = await supabase.rpc('marcar_matricula_lista', { p_nino_id: id })
    if (error) {
      // La base frena con la misma regla: un dato que se vació entre el gate y aquí se dice.
      const faltan = faltanDeHint(error.hint)
      if (faltan) return { success: false, error: 'alta.errors.incompleto', faltan }
      logger.warn('finalizarAlta', error.message)
      if (error.code === '42501') return fail('alta.errors.no_autorizado')
      return fail('alta.errors.finalizar_fallo')
    }

    // Revalida la ruta del alta (todas las locales) para que el RSC sirva la pantalla
    // "completado, pendiente de validación" tras una única navegación del cliente.
    revalidatePath('/[locale]/alta/[ninoId]', 'page')
    return ok({ id })
  } catch (e) {
    return falloDeLectura(e)
  }
}
