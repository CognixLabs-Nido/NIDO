import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { LecturaFallida } from '@/shared/lib/lectura-fallida'

export interface DatosAcreedorConfig {
  identificadorAcreedor: string | null
  bicAcreedor: string | null
  /** ¿Hay un IBAN de acreedor guardado? (nunca se revela el número). */
  ibanConfigurado: boolean
}

/**
 * Config del acreedor para el FORMULARIO: CID y BIC en claro + un booleano de si el
 * IBAN está configurado. NO descifra el IBAN (para eso está la RPC get_datos_acreedor,
 * de uso exclusivo del generador server-side). RLS: solo admin del centro.
 */
export async function getDatosAcreedor(centroId: string): Promise<DatosAcreedorConfig> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('centros')
    .select('identificador_acreedor, bic_acreedor, iban_acreedor_cifrado')
    .eq('id', centroId)
    .maybeSingle()
  // Censo C: sin leerlo, el formulario salía en blanco: «sin CID ni BIC, IBAN sin configurar».
  if (error) throw new LecturaFallida('datos del acreedor', error)

  return {
    identificadorAcreedor: data?.identificador_acreedor ?? null,
    bicAcreedor: data?.bic_acreedor ?? null,
    ibanConfigurado: data?.iban_acreedor_cifrado != null,
  }
}
