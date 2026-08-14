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

/** Desborde de beca comedor PENDIENTE de un recibo (V2-4). A nivel familia/recibo. */
export interface DesbordePanelInput {
  familiaId: string
  reciboId: string
  cuotaCentimos: number
  becaCentimos: number
  excesoCentimos: number
}

/** Una línea congelada del recibo. `ninoId` NULL = línea familiar. */
/** R-2 dejó marcadas las líneas: 'automatico' la escribió el motor, 'manual' una persona. */
export type OrigenLinea = 'automatico' | 'manual'

export interface LineaPanelInput {
  id: string
  reciboId: string
  ninoId: string | null
  conceptoId: string | null
  descripcion: string
  cantidad: number
  precioUnitarioCentimos: number
  importeCentimos: number
  origen: OrigenLinea
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
  /** El motor respeta las 'manual' al regenerar; las 'automatico' las rehace. */
  origen: OrigenLinea
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

/** Desborde de beca comedor pendiente colgado de la fila (para el aviso + el diálogo). */
export interface DesbordePanel {
  reciboId: string
  cuotaCentimos: number
  becaCentimos: number
  excesoCentimos: number
}

export interface FilaFamiliaPanel {
  familiaId: string
  etiqueta: string
  tutores: string[]
  hijos: Array<{ ninoId: string; nombre: string }>
  /** null = familia activa sin recibo generado (fila ⚠ «sin cargos»). */
  recibo: ReciboPanel | null
  /** Desborde de beca comedor PENDIENTE de este recibo (V2-4); null si no hay. */
  desborde: DesbordePanel | null
}

export interface PanelRecibosMes {
  filas: FilaFamiliaPanel[]
  indicadores: {
    numRecibos: number
    confirmados: number
    pendientes: number
    totalCentimos: number
    familiasSinRecibo: number
    /** V2-4: recibos con desborde de beca comedor pendiente de resolver. */
    desbordesPendientes: number
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
  lineas: LineaPanelInput[],
  desbordes: DesbordePanelInput[] = []
): PanelRecibosMes {
  const reciboPorFamilia = new Map<string, ReciboPanelInput>()
  for (const r of recibos) reciboPorFamilia.set(r.familiaId, r)

  const desbordePorFamilia = new Map<string, DesbordePanelInput>()
  for (const d of desbordes) desbordePorFamilia.set(d.familiaId, d)

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
          origen: l.origen,
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

    // Desborde solo si sigue habiendo recibo (el borrador puede haberse ido); se cuelga del
    // recibo por id para que el diálogo actúe sobre el recibo correcto.
    const dInput = desbordePorFamilia.get(f.familiaId)
    const desborde: DesbordePanel | null =
      dInput && recibo && dInput.reciboId === recibo.id
        ? {
            reciboId: dInput.reciboId,
            cuotaCentimos: dInput.cuotaCentimos,
            becaCentimos: dInput.becaCentimos,
            excesoCentimos: dInput.excesoCentimos,
          }
        : null

    return {
      familiaId: f.familiaId,
      etiqueta: f.etiqueta,
      tutores: f.tutores,
      hijos: f.hijos,
      recibo,
      desborde,
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
      desbordesPendientes: filas.filter((f) => f.desborde != null).length,
    },
  }
}

/** Un bloque de líneas del recibo interno: un hijo (ninoId no null) o el bloque familiar. */
export interface GrupoLineasPanel {
  ninoId: string | null
  ninoNombre: string | null
  lineas: LineaPanel[]
}

/**
 * Agrupa las líneas ya ordenadas (`ordenarLineas`: hijo→familiar, por nombre) en bloques
 * consecutivos por niño, para la vista interna del director (nombre del hijo UNA vez como
 * cabecera + sus líneas). El bloque familiar (ninoId NULL) queda al final.
 */
export function agruparLineasPanel(lineas: LineaPanel[]): GrupoLineasPanel[] {
  const grupos: GrupoLineasPanel[] = []
  for (const l of lineas) {
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && ultimo.ninoId === l.ninoId) ultimo.lineas.push(l)
    else grupos.push({ ninoId: l.ninoId, ninoNombre: l.ninoNombre, lineas: [l] })
  }
  return grupos
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
