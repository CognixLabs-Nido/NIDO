import type { RosterFirmaNino } from '@/features/autorizaciones/types'

/**
 * Datos del panel de firma de imagen que la ruta (server) pre-computa cuando ya
 * existe la instancia de `autorizacion_imagenes` del niño, y consume `PasoMenor`
 * (client) para renderizar `FirmarAutorizacionPanel`. Si no hay instancia todavía,
 * la ruta pasa `null` y el paso ofrece instanciarla (`crearImagenAutorizacion`).
 */
export interface ImagenPanelData {
  autorizacionId: string
  firmable: boolean
  roster: RosterFirmaNino[]
}

/**
 * Datos de un panel de firma genérico (misma forma que `ImagenPanelData`). En G-1 lo usa
 * el paso de acuses para firmar las **normas de régimen interno** (`reglas_regimen_interno`,
 * patrón A: la dirección publica la instancia, la familia la firma). La ruta lo pre-computa
 * buscando la instancia publicada aplicable al niño; si no hay, pasa `null` (el paso lo omite).
 */
export type FirmaPanelData = ImagenPanelData

/** Valores médicos descifrados para prerrellenar el paso médico (o null). */
export interface MedicaInicial {
  alergias_graves: string | null
  notas_emergencia: string | null
  medicacion_habitual: string | null
  alergias_leves: string | null
  medico_familia: string | null
  telefono_emergencia: string | null
}
