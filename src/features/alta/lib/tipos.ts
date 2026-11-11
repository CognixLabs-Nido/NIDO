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

/** Valores médicos descifrados para prerrellenar el paso médico (o null). */
export interface MedicaInicial {
  alergias_graves: string | null
  notas_emergencia: string | null
  medicacion_habitual: string | null
  alergias_leves: string | null
  medico_familia: string | null
  telefono_emergencia: string | null
}

/** Lo guardado del niño con lo que arranca el paso del menor (y su formulario). */
export interface IdentidadInicial {
  primer_apellido: string | null
  segundo_apellido: string | null
  fecha_nacimiento: string | null
  sexo: 'F' | 'M' | 'X' | null
  nacionalidad: string | null
  idioma_principal: string
  // Fase 5b
  lugar_nacimiento: string | null
  dni: string | null
  hermanos_total: number | null
  hermanos_lugar: number | null
  direccion_provincia: string | null
  observaciones_familia: string | null
  como_nos_conocio: string | null
  como_nos_conocio_otro: string | null
}
