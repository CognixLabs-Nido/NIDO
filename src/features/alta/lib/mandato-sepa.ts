/**
 * F11-G-2 — utilidades PURAS del mandato SEPA (sin DOM ni `server-only`): generación del
 * identificador único de mandato y construcción del texto canónico que se hashea
 * (`texto_hash`). Reutilizable en cliente (genera el id para embeberlo en el PDF) y en
 * servidor (recalcula el canónico y firma el hash). Cubierto por tests unitarios.
 */

import { normalizarIban } from './iban'

/** Tope de la columna `mandatos_sepa.identificador_mandato` (CHECK G-0: 1..80). */
export const MAX_LARGO_IDENTIFICADOR = 80

/** Recorta un UUID a su parte significativa para el identificador (8 hex sin guiones). */
function corto(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase()
}

/**
 * Identificador único de mandato `NIDO-{centroCorto}-{tutorCorto}-{timestamp}` (decisión E,
 * formato del comentario de la migración G-0). `timestampMs` se inyecta (no se llama a
 * `Date.now()` aquí) para que sea testeable y determinista. Lo consume la fase B (pain.008)
 * en los giros, por eso debe quedar estable una vez firmado el mandato.
 */
export function generarIdentificadorMandato(
  centroId: string,
  tutorId: string,
  timestampMs: number
): string {
  return `NIDO-${corto(centroId)}-${corto(tutorId)}-${timestampMs}`
}

export interface DatosCanonicoMandato {
  identificadorMandato: string
  iban: string
  titular: string
  acreedorNombre: string
  /** Fecha de firma en ISO (solo la parte de fecha es relevante para el documento). */
  fechaFirmaIso: string
}

/**
 * Texto canónico (estable, independiente del idioma de presentación) sobre el que se calcula
 * `texto_hash`. Ancla los campos legalmente vinculantes del mandato (identificador, IBAN
 * normalizado, titular, acreedor, tipo recurrente, fecha) — el PDF puede rotular en es/en/va
 * sin afectar al hash, igual que el patrón de hash de F8.
 */
export function textoCanonicoMandato(d: DatosCanonicoMandato): string {
  return [
    'SEPA-CORE-MANDATE',
    `id=${d.identificadorMandato}`,
    `iban=${normalizarIban(d.iban)}`,
    `titular=${d.titular.trim()}`,
    `acreedor=${d.acreedorNombre.trim()}`,
    'tipo=recurrente',
    `fecha=${d.fechaFirmaIso.slice(0, 10)}`,
  ].join('|')
}
