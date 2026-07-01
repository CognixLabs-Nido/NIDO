// Mapea la pivote de recibos a filas CSV (F12-B-7). Puro: recibe las etiquetas y
// traductores por parámetro (la ruta los resuelve con next-intl) para poder testearlo
// sin i18n. El importe se emite en euros con coma decimal (Excel-ES); `generarCsv` lo
// entrecomilla al detectar la coma, así que no colisiona con el separador de campos.

import type { PivoteRecibos } from './pivote'
import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']
type MetodoPago = Database['public']['Enums']['metodo_pago']

export interface TextosPivoteCsv {
  tutor: string
  nino: string
  estado: string
  metodo: string
  total: string
  totalesFila: string
  sinMetodo: string
  estadoLabel: (e: EstadoRecibo) => string
  metodoLabel: (m: MetodoPago) => string
}

/** Céntimos → euros con coma decimal, p. ej. -1500 → "-15,00". */
export function centimosACsv(centimos: number): string {
  return (centimos / 100).toFixed(2).replace('.', ',')
}

/** Filas del CSV: cabecera + una fila por recibo + fila de totales por columna. */
export function pivoteACsvFilas(pivote: PivoteRecibos, textos: TextosPivoteCsv): string[][] {
  const cabecera = [
    textos.tutor,
    textos.nino,
    textos.estado,
    textos.metodo,
    ...pivote.columnas.map((c) => c.label),
    textos.total,
  ]

  const filas = pivote.filas.map((f) => [
    f.tutorNombre,
    f.ninoNombre,
    textos.estadoLabel(f.estado),
    f.metodo ? textos.metodoLabel(f.metodo) : textos.sinMetodo,
    ...pivote.columnas.map((c) =>
      f.celdas[c.key] !== undefined ? centimosACsv(f.celdas[c.key]) : ''
    ),
    centimosACsv(f.totalCentimos),
  ])

  const totales = [
    textos.totalesFila,
    '',
    '',
    '',
    ...pivote.columnas.map((c) => centimosACsv(pivote.totalesColumna[c.key] ?? 0)),
    centimosACsv(pivote.totalGeneral),
  ]

  return [cabecera, ...filas, totales]
}
