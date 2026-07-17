// Construcción del cuadro del PANEL DEL MES a grano FAMILIA (F-4-4). Puro y sin
// dependencias (Supabase queda en la query): testeable como función. Espejo de
// `construirPivote`, pero la fila es una FAMILIA (no un recibo por-niño): agrupa el
// recibo regular familiar del mes con su desglose de líneas (de hijo con `ninoId`, o
// familiares con `ninoId` NULL: descuento hermanos, saldo, cargo de familia). Incluye
// las familias activas SIN recibo (el motor descartó 0 líneas o aún no se generó) para
// que la directora detecte olvidos.

import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']
type MetodoPago = Database['public']['Enums']['metodo_pago']

/** Una familia del centro con sus tutores e hijos activos (venga o no con recibo). */
export interface FamiliaPanelInput {
  familiaId: string
  etiqueta: string
  tutores: string[]
  hijos: Array<{ ninoId: string; nombre: string }>
}

/** El recibo regular familiar del mes (si el motor lo generó). */
export interface ReciboPanelInput {
  id: string
  familiaId: string
  estado: EstadoRecibo
  metodo: MetodoPago | null
  totalCentimos: number
}

/** Una línea congelada del recibo. `ninoId` NULL = línea familiar. */
export interface LineaPanelInput {
  id: string
  reciboId: string
  ninoId: string | null
  conceptoId: string | null
  descripcion: string
  cantidad: number
  precioUnitarioCentimos: number
  importeCentimos: number
}

export interface LineaPanel {
  id: string
  ninoId: string | null
  ninoNombre: string | null
  conceptoId: string | null
  descripcion: string
  cantidad: number
  precioUnitarioCentimos: number
  importeCentimos: number
}

export interface ReciboPanel {
  id: string
  estado: EstadoRecibo
  metodo: MetodoPago | null
  /** Suma de líneas con importe > 0. */
  cargosCentimos: number
  /** Suma de líneas con importe < 0 (becas, descuentos, saldo negativo). En negativo. */
  descuentosCentimos: number
  /** `total_centimos` congelado del recibo (fuente de verdad, no recomputado). */
  totalCentimos: number
  lineas: LineaPanel[]
}

export interface FilaFamiliaPanel {
  familiaId: string
  etiqueta: string
  tutores: string[]
  hijos: Array<{ ninoId: string; nombre: string }>
  /** null = familia activa sin recibo generado (fila ⚠ «sin cargos»). */
  recibo: ReciboPanel | null
}

export interface PanelRecibosMes {
  filas: FilaFamiliaPanel[]
  indicadores: {
    numRecibos: number
    confirmados: number
    pendientes: number
    totalCentimos: number
    familiasSinRecibo: number
  }
}

/** Un recibo está confirmado (congelado) si ha salido de 'borrador'. */
export function esConfirmado(estado: EstadoRecibo): boolean {
  return estado !== 'borrador'
}

/**
 * Construye el cuadro del panel a partir de las familias del centro, sus recibos
 * regulares del mes y las líneas. Determinista: filas por etiqueta de familia
 * (locale es-ES); líneas por hijo→familiar y por importe. El total de fila usa el
 * `totalCentimos` congelado del recibo (no la suma de líneas).
 */
export function construirPanelFamilia(
  familias: FamiliaPanelInput[],
  recibos: ReciboPanelInput[],
  lineas: LineaPanelInput[]
): PanelRecibosMes {
  const reciboPorFamilia = new Map<string, ReciboPanelInput>()
  for (const r of recibos) reciboPorFamilia.set(r.familiaId, r)

  const lineasPorRecibo = new Map<string, LineaPanelInput[]>()
  for (const l of lineas) {
    const actual = lineasPorRecibo.get(l.reciboId) ?? []
    actual.push(l)
    lineasPorRecibo.set(l.reciboId, actual)
  }

  const filas: FilaFamiliaPanel[] = familias.map((f) => {
    const nombrePorNino = new Map(f.hijos.map((h) => [h.ninoId, h.nombre]))
    const reciboInput = reciboPorFamilia.get(f.familiaId)

    let recibo: ReciboPanel | null = null
    if (reciboInput) {
      const brutas = lineasPorRecibo.get(reciboInput.id) ?? []
      const lineasPanel: LineaPanel[] = brutas
        .map((l) => ({
          id: l.id,
          ninoId: l.ninoId,
          ninoNombre: l.ninoId ? (nombrePorNino.get(l.ninoId) ?? null) : null,
          conceptoId: l.conceptoId,
          descripcion: l.descripcion,
          cantidad: l.cantidad,
          precioUnitarioCentimos: l.precioUnitarioCentimos,
          importeCentimos: l.importeCentimos,
        }))
        .sort(ordenarLineas)

      const cargosCentimos = brutas
        .filter((l) => l.importeCentimos > 0)
        .reduce((acc, l) => acc + l.importeCentimos, 0)
      const descuentosCentimos = brutas
        .filter((l) => l.importeCentimos < 0)
        .reduce((acc, l) => acc + l.importeCentimos, 0)

      recibo = {
        id: reciboInput.id,
        estado: reciboInput.estado,
        metodo: reciboInput.metodo,
        cargosCentimos,
        descuentosCentimos,
        totalCentimos: reciboInput.totalCentimos,
        lineas: lineasPanel,
      }
    }

    return {
      familiaId: f.familiaId,
      etiqueta: f.etiqueta,
      tutores: f.tutores,
      hijos: f.hijos,
      recibo,
    }
  })

  filas.sort(
    (a, b) =>
      a.etiqueta.localeCompare(b.etiqueta, 'es-ES') || a.familiaId.localeCompare(b.familiaId)
  )

  const conRecibo = filas.filter((f) => f.recibo != null)
  const confirmados = conRecibo.filter((f) => esConfirmado(f.recibo!.estado)).length
  const totalCentimos = conRecibo.reduce((acc, f) => acc + f.recibo!.totalCentimos, 0)

  return {
    filas,
    indicadores: {
      numRecibos: conRecibo.length,
      confirmados,
      pendientes: conRecibo.length - confirmados,
      totalCentimos,
      familiasSinRecibo: filas.length - conRecibo.length,
    },
  }
}

// Líneas: primero las de hijo (agrupadas por nombre de hijo), luego las familiares
// (ninoId NULL); dentro, positivas antes que negativas; desempate por descripción.
function ordenarLineas(a: LineaPanel, b: LineaPanel): number {
  const aFam = a.ninoId == null ? 1 : 0
  const bFam = b.ninoId == null ? 1 : 0
  if (aFam !== bFam) return aFam - bFam
  const nombre = (a.ninoNombre ?? '').localeCompare(b.ninoNombre ?? '', 'es-ES')
  if (nombre !== 0) return nombre
  const signo = Number(b.importeCentimos > 0) - Number(a.importeCentimos > 0)
  if (signo !== 0) return signo
  return a.descripcion.localeCompare(b.descripcion, 'es-ES')
}
