'use server'

import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'

export interface TelefonoFamilia {
  rol: 'titular' | 'segundo_tutor'
  nombre: string | null
  telefono: string | null
}

/**
 * Fase 6 (2026-11-13): los teléfonos de la familia de un niño, para el botón «Llamar a la familia»
 * (cuando le sube la fiebre, sin pedírselo a Dirección). Se leen AL PULSAR, no con la lista del aula,
 * por `telefonos_familia_de_nino`: la profe del aula del niño, la Dirección y los tutores; el
 * autorizado, nada. Un fallo de lectura no es «sin teléfono»: vuelve como error.
 */
export async function telefonosFamilia(ninoId: string): Promise<ActionResult<TelefonoFamilia[]>> {
  const parsed = z.string().uuid().safeParse(ninoId)
  if (!parsed.success) return fail('familias.llamar.errors.no_leido')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('telefonos_familia_de_nino', {
    p_nino_id: parsed.data,
  })
  if (error) {
    logger.warn('telefonosFamilia', error.code ?? 'sin_codigo')
    return fail('familias.llamar.errors.no_leido')
  }
  return ok(
    (data ?? []).map((t) => ({
      rol: t.rol_familia === 'titular' ? 'titular' : 'segundo_tutor',
      nombre: t.nombre_completo,
      telefono: t.telefono,
    }))
  )
}
