import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']
type MetodoPago = Database['public']['Enums']['metodo_pago']

/** PR-2: cómo se resolvió una devolución (una sola vez). */
export type SalidaDevolucion = 'banco' | 'efectivo' | 'transferencia'

export interface ReciboGestion {
  id: string
  /** F-4-5: los recibos son familiares → se muestra la familia (antes el niño). */
  familiaEtiqueta: string
  totalCentimos: number
  estado: EstadoRecibo
  metodo: MetodoPago | null
  esEsporadico: boolean
  conceptoEsporadico: string | null
  fechaEnvioBanco: string | null
  fechaDevolucion: string | null
  /** ¿Es un recibo de re-giro (ligado a un devuelto)? */
  esRegiro: boolean
  /** PR-2: los gastos de la devolución (con fecha_devolucion) y su salida, si ya se resolvió. */
  devolucionGastosCentimos: number | null
  devolucionSalida: SalidaDevolucion | null
  /** PR-1a: el cobro manual (solo con estado cobrado_manual). */
  cobroForma: MetodoPago | null
  cobroFecha: string | null
  cobroNota: string | null
  /** PR-1b: el importe del cheque guardería / ticket restaurant (solo con esa forma). */
  cobroImporteCentimos: number | null
  /** PR-1b: ¿es el recibo esporádico de la diferencia de un cheque? */
  esDiferenciaCheque: boolean
  /** ¿Tiene la familia mandato SEPA activo? Sin él, la diferencia no se puede pasar al banco. */
  familiaConMandato: boolean
}

/** Estados que lee la gestión: los pendientes y los que ya están en el ciclo de cobro. */
export const ESTADOS_GESTION = [
  'pendiente_procesar',
  'enviado_banco',
  'devuelto',
  'cobrado_manual',
] as const satisfies readonly EstadoRecibo[]

/**
 * ¿Sale el recibo en la gestión? Todos los del ciclo de cobro, y de los pendientes solo los que
 * se cobran a mano: un SEPA pendiente va por remesa (y la BD no deja cobrarlo a mano). Un
 * borrador nunca sale.
 */
export function entraEnGestion(r: { estado: EstadoRecibo; metodo: MetodoPago | null }): boolean {
  if (r.estado === 'pendiente_procesar') return r.metodo !== 'sepa'
  return (ESTADOS_GESTION as readonly EstadoRecibo[]).includes(r.estado)
}

/**
 * ¿Se puede marcar cobrado a mano? Un pendiente que no es SEPA. Un devuelto no: tiene una sola
 * salida y se resuelve aparte (PR-2).
 */
export function cobrableAMano(r: Pick<ReciboGestion, 'estado' | 'metodo'>): boolean {
  return r.estado === 'pendiente_procesar' && r.metodo !== 'sepa'
}

/** ¿Espera la devolución su salida? Un devuelto que todavía no se ha resuelto (PR-2). */
export function devolucionPorResolver(
  r: Pick<ReciboGestion, 'estado' | 'devolucionSalida'>
): boolean {
  return r.estado === 'devuelto' && r.devolucionSalida === null
}

/** Lo que cobra la salida de una devolución: el recibo más los gastos del banco (PR-2). */
export function importeDevolucion(
  r: Pick<ReciboGestion, 'totalCentimos' | 'devolucionGastosCentimos'>
): number {
  return r.totalCentimos + (r.devolucionGastosCentimos ?? 0)
}

/**
 * La forma que propone «Marcar cobrado»: la del método del recibo cuando se cobra a mano
 * (transferencia o cheque); si no, efectivo.
 */
export function formaPorDefecto(
  r: Pick<ReciboGestion, 'metodo'>
): 'efectivo' | 'transferencia' | 'cheque_guarderia' {
  if (r.metodo === 'transferencia' || r.metodo === 'cheque_guarderia') return r.metodo
  return 'efectivo'
}

const ORDEN: Record<EstadoRecibo, number> = {
  pendiente_procesar: 0,
  devuelto: 1,
  enviado_banco: 2,
  cobrado_manual: 3,
  borrador: 4,
}

/** Un devuelto ya resuelto no pide nada: va con los cobrados (PR-2). */
function rango(r: ReciboGestion): number {
  return r.estado === 'devuelto' && r.devolucionSalida !== null
    ? ORDEN.cobrado_manual
    : ORDEN[r.estado]
}

/** Primero lo que pide una acción (pendientes, devueltos sin resolver); dentro, por familia. */
export function ordenarGestion(recibos: ReciboGestion[]): ReciboGestion[] {
  return [...recibos].sort(
    (a, b) =>
      rango(a) - rango(b) ||
      a.familiaEtiqueta.localeCompare(b.familiaEtiqueta, 'es-ES') ||
      a.id.localeCompare(b.id)
  )
}
