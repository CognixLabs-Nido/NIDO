// Utilidad mínima de exportación CSV (F12-B-7). Pura y sin dependencias: testeable.
// Formato RFC 4180 (comillas dobles, escape doblando comillas, CRLF entre filas). Se
// antepone el BOM UTF-8 para que Excel (Windows) reconozca los acentos correctamente.

const BOM = '﻿'

/** Escapa un valor de celda: lo entrecomilla si contiene coma, comilla o salto de línea. */
export function escaparCelda(valor: string | number): string {
  const s = String(valor)
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** Serializa filas (array de arrays) a un texto CSV con BOM. Cada fila = una línea CRLF. */
export function generarCsv(filas: (string | number)[][]): string {
  const cuerpo = filas.map((fila) => fila.map(escaparCelda).join(',')).join('\r\n')
  return BOM + cuerpo
}
