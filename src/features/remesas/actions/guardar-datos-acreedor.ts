'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { datosAcreedorSchema, type DatosAcreedorInput } from '../schemas/remesa'

/**
 * Guarda la config del acreedor (CID/BIC en claro + IBAN cifrado) vía la RPC
 * admin-only set_datos_acreedor. IBAN vacío = preservar el existente. Solo admin
 * (la RPC lo verifica). El IBAN nunca vuelve legible al cliente.
 */
export async function guardarDatosAcreedor(input: DatosAcreedorInput): Promise<ActionResult<null>> {
  const parsed = datosAcreedorSchema.safeParse(input)
  if (!parsed.success) return fail('remesas.errors.invalid')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('remesas.errors.no_autorizado')

  const supabase = await createClient()
  const { error } = await supabase.rpc('set_datos_acreedor', {
    p_centro_id: centroId,
    p_identificador_acreedor: parsed.data.identificador_acreedor,
    p_bic_acreedor: parsed.data.bic_acreedor,
    // `as string`: el generador de tipos de Supabase NO expresa la nulabilidad de los
    // argumentos de RPC (Postgres no reporta si un parámetro admite NULL), así que emite
    // `p_iban: string`. El runtime SÍ acepta null a propósito — la función SQL documenta
    // `p_iban text  -- NULL o '' = preservar el IBAN cifrado existente` y hace
    // `coalesce(p_iban, '')`; enviar null es el modo "no reescribir el IBAN". El cast solo
    // compensa esa limitación del generador: NO lo elimines ni lo "arregles" — sin él, cada
    // regeneración de database.ts rompe el typecheck. Ver PR de resync de database.ts.
    p_iban: (parsed.data.iban === '' ? null : parsed.data.iban) as string,
  })

  if (error) {
    logger.warn('guardarDatosAcreedor error', error.message)
    if (error.code === '42501') return fail('remesas.errors.no_autorizado')
    return fail('remesas.errors.guardar_acreedor_failed')
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok(null)
}
