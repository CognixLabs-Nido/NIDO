import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { leerPaseServicios } from '../lib/leer-pase-servicios'
import type { FilaPase } from '../lib/pase-servicios'

export interface PaseServiciosData {
  filas: FilaPase[]
  /** La lectura falló: la página lo dice en vez de enseñar un listado vacío. */
  error: boolean
}

/** PR-12 — el listado único del pase de servicios de un día, para el centro de la página. */
export async function getPaseServicios(
  centroId: string,
  fecha: string
): Promise<PaseServiciosData> {
  const supabase = await createClient()
  try {
    return { filas: await leerPaseServicios(supabase, centroId, fecha), error: false }
  } catch (e) {
    logger.error('getPaseServicios', e instanceof Error ? e.message : String(e))
    return { filas: [], error: true }
  }
}
