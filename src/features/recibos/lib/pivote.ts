// Construcción de la tabla pivote de recibos de un período (F12-B-7). Pura y sin
// dependencias (Supabase queda en la query): testeable como función. Filas = un recibo
// (tutor + niño + estado + método); columnas = por concepto con su importe; más el total
// por fila y los totales por columna y general.

import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']
type MetodoPago = Database['public']['Enums']['metodo_pago']

/** Un recibo del período, ya normalizado desde la tabla. */
export interface ReciboPivoteInput {
  id: string
  ninoId: string
  estado: EstadoRecibo
  metodo: MetodoPago | null
  totalCentimos: number
  esEsporadico: boolean
  esRegiro: boolean
}

/** Una línea congelada del recibo (importe puede ser negativo: becas/saldo). */
export interface LineaPivoteInput {
  reciboId: string
  conceptoId: string | null
  descripcion: string
  importeCentimos: number
}

export interface PivoteColumna {
  /** Identidad estable: `concepto_id` o `desc:<descripcion>` para líneas sin concepto. */
  key: string
  label: string
}

export interface PivoteFila {
  reciboId: string
  tutorNombre: string
  ninoNombre: string
  estado: EstadoRecibo
  metodo: MetodoPago | null
  esEsporadico: boolean
  esRegiro: boolean
  /** Importe por columna (céntimos); ausente = sin línea en esa columna. */
  celdas: Record<string, number>
  totalCentimos: number
}

export interface PivoteRecibos {
  columnas: PivoteColumna[]
  filas: PivoteFila[]
  totalesColumna: Record<string, number>
  totalGeneral: number
}

export interface PivoteMaps {
  ninoNombre: Map<string, string>
  tutorNombre: Map<string, string>
  conceptoNombre: Map<string, string>
}

/**
 * Clave de columna de una línea: `concepto_id` cuando existe (agrupa por el nombre del
 * catálogo, estable y sin "(N días)"); si no, `desc:<descripcion>` (becas/saldo, pocos
 * valores distintos). La etiqueta usa el nombre del catálogo cuando hay concepto.
 */
function columnaDeLinea(l: LineaPivoteInput, conceptoNombre: Map<string, string>): PivoteColumna {
  if (l.conceptoId) {
    return { key: l.conceptoId, label: conceptoNombre.get(l.conceptoId) ?? l.descripcion }
  }
  return { key: `desc:${l.descripcion}`, label: l.descripcion }
}

/**
 * Construye la pivote a partir de los recibos del período, sus líneas y los mapas de
 * nombres. Determinista: columnas ordenadas por etiqueta (locale es-ES); filas por
 * tutor→niño→recibo. El total de fila usa `totalCentimos` congelado del recibo (fuente
 * de verdad), no la suma de celdas (que puede no cubrir columnas sin concepto).
 */
export function construirPivote(
  recibos: ReciboPivoteInput[],
  lineas: LineaPivoteInput[],
  maps: PivoteMaps
): PivoteRecibos {
  const columnasPorKey = new Map<string, PivoteColumna>()
  const celdasPorRecibo = new Map<string, Record<string, number>>()

  for (const l of lineas) {
    const col = columnaDeLinea(l, maps.conceptoNombre)
    if (!columnasPorKey.has(col.key)) columnasPorKey.set(col.key, col)
    const celdas = celdasPorRecibo.get(l.reciboId) ?? {}
    celdas[col.key] = (celdas[col.key] ?? 0) + l.importeCentimos
    celdasPorRecibo.set(l.reciboId, celdas)
  }

  const columnas = [...columnasPorKey.values()].sort((a, b) =>
    a.label.localeCompare(b.label, 'es-ES')
  )

  const filas: PivoteFila[] = recibos.map((r) => ({
    reciboId: r.id,
    tutorNombre: maps.tutorNombre.get(r.ninoId) ?? '',
    ninoNombre: maps.ninoNombre.get(r.ninoId) ?? '',
    estado: r.estado,
    metodo: r.metodo,
    esEsporadico: r.esEsporadico,
    esRegiro: r.esRegiro,
    celdas: celdasPorRecibo.get(r.id) ?? {},
    totalCentimos: r.totalCentimos,
  }))

  filas.sort(
    (a, b) =>
      a.tutorNombre.localeCompare(b.tutorNombre, 'es-ES') ||
      a.ninoNombre.localeCompare(b.ninoNombre, 'es-ES') ||
      a.reciboId.localeCompare(b.reciboId)
  )

  const totalesColumna: Record<string, number> = {}
  for (const col of columnas) totalesColumna[col.key] = 0
  for (const fila of filas) {
    for (const col of columnas) {
      const v = fila.celdas[col.key]
      if (v !== undefined) totalesColumna[col.key] += v
    }
  }
  const totalGeneral = filas.reduce((acc, f) => acc + f.totalCentimos, 0)

  return { columnas, filas, totalesColumna, totalGeneral }
}
