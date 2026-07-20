'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Vía B — acuse por-niño de NORMAS / IMAGEN por checkbox, SIN documento, SIN firma, SIN
 * trazo. Escribe una fila en `acuses_alta` que el gate de finalizar reconoce como acuse
 * válido ADEMÁS de la firma real (`firmas_autorizacion`). Aceptar NO depende de que exista
 * una instancia/plantilla publicada. SEPA es aparte (se firma en pantalla con trazo).
 *
 * `centro_id` se deriva server-side del niño (no falseable); la RLS exige además
 * `centro_de_nino(nino_id) = centro_id` y `es_tutor_de(nino_id)` — el tutor solo registra
 * el acuse de su hijo. `firmante_id = auth.uid()` (anti-suplantación). Idempotente: el
 * UNIQUE (nino_id, tipo) hace que re-aceptar (23505) sea un no-op tratado como éxito.
 */
const registrarAcuseAltaSchema = z.object({
  nino_id: z.string().uuid(),
  tipo: z.enum(['normas', 'imagen']),
})

export type RegistrarAcuseAltaInput = z.infer<typeof registrarAcuseAltaSchema>

export async function registrarAcuseAlta(
  input: RegistrarAcuseAltaInput
): Promise<ActionResult<{ ok: true }>> {
  const parsed = registrarAcuseAltaSchema.safeParse(input)
  if (!parsed.success) return fail('alta.errors.acuse_fallo')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('alta.errors.no_autorizado')

  // Centro del niño (server-derivado; la RLS exige centro_de_nino(nino_id) = centro_id).
  const { data: nino } = await supabase
    .from('ninos')
    .select('centro_id')
    .eq('id', parsed.data.nino_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!nino) return fail('alta.errors.acuse_fallo')

  const { error } = await supabase.from('acuses_alta').insert({
    nino_id: parsed.data.nino_id,
    centro_id: nino.centro_id,
    tipo: parsed.data.tipo,
    firmante_id: user.id,
  })
  // 23505 = ya aceptado (UNIQUE nino+tipo) → idempotente, éxito.
  if (error && error.code !== '23505') {
    logger.warn('registrarAcuseAlta', error.message)
    if (error.code === '42501') return fail('alta.errors.no_autorizado')
    return fail('alta.errors.acuse_fallo')
  }

  revalidatePath('/[locale]/alta/[ninoId]', 'page')
  return ok({ ok: true })
}
