'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { firmaConDatosVigente } from '../lib/estado-firma'
import { revalidarAutorizaciones } from '../lib/server-helpers'
import {
  registrarAdministracionSchema,
  type RegistrarAdministracionInput,
} from '../schemas/autorizaciones'
import { fail, ok, type ActionResult, type MedicacionDatos } from '../types'

/**
 * **F8-3b — Registrar una administración de medicación (1.er staff).** Una
 * profe del aula / la dirección deja constancia de que ha administrado una dosis.
 * La fila nace PENDIENTE (confirmado_por NULL); un 2.º staff distinto la confirma
 * (`confirmarAdministracion`). El snapshot medicamento/dosis se toma de la última
 * firma `firmado` (la vigente). Toda la guarda real está en la BD:
 *
 *   - RLS de INSERT: staff del niño, `administrado_por = auth.uid()`,
 *     `confirmado_por` NULL, centro coherente, y `medicacion_administrable_hoy`
 *     (FIRMADA + VIGENTE hoy). Una medicación futura/caducada/sin firma → 42501.
 *
 * El `administrado_en` lo pone la BD (now()): se registra en el momento de darla.
 */
export async function registrarAdministracion(
  input: RegistrarAdministracionInput
): Promise<ActionResult<{ administracion_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = registrarAdministracionSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'autorizaciones.errors.adm_registro_fallo')
  }
  const d = parsed.data

  // Instancia de medicación (centro + niño). RLS ya filtra: si el staff no es
  // audiencia del niño, no la ve.
  const { data: aut } = await supabase
    .from('autorizaciones')
    .select('id, tipo, es_plantilla, centro_id, nino_id')
    .eq('id', d.autorizacion_id)
    .maybeSingle()
  if (!aut || aut.es_plantilla || aut.tipo !== 'medicacion' || !aut.nino_id) {
    return fail('autorizaciones.errors.adm_no_medicacion')
  }

  // Snapshot medicamento/dosis de la firma VIGENTE (no de la última `firmado` del
  // histórico: una ficha revocada no vale). Si no hay, no se registra; la RLS
  // (`medicacion_administrable_hoy`) lo rechazaría igualmente.
  const { data: firmas } = await supabase
    .from('firmas_autorizacion')
    .select('firmante_id, decision, firmado_at, datos')
    .eq('autorizacion_id', aut.id)
  const vigente = firmaConDatosVigente(firmas ?? [])
  const medicacion = (vigente?.datos as { medicacion?: MedicacionDatos } | null)?.medicacion ?? null
  if (!medicacion) return fail('autorizaciones.errors.adm_sin_firma')

  const { data: row, error } = await supabase
    .from('administraciones_medicacion')
    .insert({
      autorizacion_id: aut.id,
      nino_id: aut.nino_id,
      centro_id: aut.centro_id,
      administrado_por: user.id,
      medicamento: medicacion.medicamento.slice(0, 200),
      dosis: medicacion.dosis.slice(0, 200),
      notas: d.notas?.trim() ? d.notas.trim() : null,
    })
    .select('id')
    .maybeSingle()
  if (error || !row) {
    logger.warn('registrarAdministracion: insert', error?.message)
    // 42501 = la RLS rechazó (no staff del niño, o medicación no administrable hoy).
    if (error?.code === '42501') return fail('autorizaciones.errors.adm_no_permitido')
    return fail('autorizaciones.errors.adm_registro_fallo')
  }

  revalidarAutorizaciones()
  return ok({ administracion_id: row.id })
}
