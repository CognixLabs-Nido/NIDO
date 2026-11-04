/**
 * F11-G-2 — utilidades PURAS del mandato SEPA (sin DOM ni `server-only`): generación del
 * identificador único de mandato y construcción del texto canónico que se hashea
 * (`texto_hash`). Reutilizable en cliente (genera el id para embeberlo en el PDF) y en
 * servidor (recalcula el canónico y firma el hash). Cubierto por tests unitarios.
 */

import { normalizarIban } from './iban'

/** Tope de la columna `mandatos_sepa.identificador_mandato` (CHECK G-0: 1..80). */
export const MAX_LARGO_IDENTIFICADOR = 80

/**
 * Tope del `MndtId` en el fichero pain.008.001.02 (Max35Text). Es el que manda: la columna
 * admite 80, pero un mandato de 36 lo rechaza el banco que valide el esquema (PR-0b de
 * `docs/specs/altas-serie.md`).
 */
export const MAX_LARGO_ID_SEPA = 35

/** Recorta un UUID a su parte significativa para el identificador (8 hex sin guiones). */
function corto(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase()
}

/**
 * Identificador único de mandato `NIDO-{centroCorto}-{tutorCorto}-{timestamp}` (decisión E,
 * formato del comentario de la migración G-0). `timestampMs` se inyecta (no se llama a
 * `Date.now()` aquí) para que sea testeable y determinista. Lo consume la fase B (pain.008)
 * en los giros, por eso debe quedar estable una vez firmado el mandato.
 *
 * El timestamp va en base 36: en decimal (13 dígitos) el identificador medía 36 y no cabía en
 * el `MndtId` (Max35). En base 36 son 8 caracteres hoy y 11 para cualquier entero seguro, así
 * que el identificador no pasa de 34. Los mandatos ya firmados conservan el suyo: es el que
 * firmó la familia.
 */
export function generarIdentificadorMandato(
  centroId: string,
  tutorId: string,
  timestampMs: number
): string {
  return `NIDO-${corto(centroId)}-${corto(tutorId)}-${timestampMs.toString(36).toUpperCase()}`
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

export interface DatosCanonicoMandatoV2 extends DatosCanonicoMandato {
  /** El identificador de acreedor (CID) del centro con el que se firma. */
  acreedorCid: string
  /** «NIF o documento de identidad» del titular, tal como se guarda. */
  titularDocumento: string
  titularDireccion: string
}

/**
 * Texto canónico **v2** (0c-2, `mandatos_sepa.version_canonico = 2`): el v1 más el CID del
 * acreedor y el documento y la dirección del titular. Los mandatos firmados antes se quedan en v1
 * (`textoCanonicoMandato`, que no cambia): su hash se recalcula con aquel texto. La base guarda la
 * foto del CID y del nombre del acreedor del momento de firmar (`acreedor_cid`,
 * `acreedor_nombre`), para que el hash se pueda recalcular aunque el centro cambie después.
 *
 * Las claves nuevas van con su nombre y en un orden fijo; una cadena vacía no es lo mismo que un
 * campo que falta, por eso la versión va en la primera línea.
 */
export function textoCanonicoMandatoV2(d: DatosCanonicoMandatoV2): string {
  return [
    'SEPA-CORE-MANDATE-V2',
    `id=${d.identificadorMandato}`,
    `iban=${normalizarIban(d.iban)}`,
    `titular=${d.titular.trim()}`,
    `titular_documento=${d.titularDocumento.trim()}`,
    `titular_direccion=${d.titularDireccion.trim()}`,
    `acreedor=${d.acreedorNombre.trim()}`,
    `acreedor_cid=${d.acreedorCid.trim()}`,
    'tipo=recurrente',
    `fecha=${d.fechaFirmaIso.slice(0, 10)}`,
  ].join('|')
}
