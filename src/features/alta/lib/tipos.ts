import type { RosterFirmaNino } from '@/features/autorizaciones/types'

/**
 * Datos del panel de firma de imagen que la ruta (server) pre-computa cuando ya
 * existe la instancia de `autorizacion_imagenes` del niño, y consume `PasoImagen`
 * (client) para renderizar `FirmarAutorizacionPanel`. Si no hay instancia todavía,
 * la ruta pasa `null` y el paso ofrece instanciarla (`crearImagenAutorizacion`).
 */
export interface ImagenPanelData {
  autorizacionId: string
  firmable: boolean
  roster: RosterFirmaNino[]
}

/** Valores médicos descifrados para prerrellenar el paso médico (o null). */
export interface MedicaInicial {
  alergias_graves: string | null
  notas_emergencia: string | null
  medicacion_habitual: string | null
  alergias_leves: string | null
  medico_familia: string | null
  telefono_emergencia: string | null
}
