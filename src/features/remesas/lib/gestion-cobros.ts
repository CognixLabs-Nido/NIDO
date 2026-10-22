import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']
type MetodoPago = Database['public']['Enums']['metodo_pago']

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
  /** PR-1a: el cobro manual (solo con estado cobrado_manual). */
  cobroForma: MetodoPago | null
  cobroFecha: string | null
  cobroNota: string | null
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

/** ¿Se puede marcar cobrado a mano? Un pendiente que no es SEPA, o un devuelto. */
export function cobrableAMano(r: Pick<ReciboGestion, 'estado' | 'metodo'>): boolean {
  if (r.estado === 'devuelto') return true
  return r.estado === 'pendiente_procesar' && r.metodo !== 'sepa'
}

const ORDEN: Record<EstadoRecibo, number> = {
  pendiente_procesar: 0,
  devuelto: 1,
  enviado_banco: 2,
  cobrado_manual: 3,
  borrador: 4,
}

/** Primero lo que pide una acción (pendientes, devueltos); dentro, por familia. */
export function ordenarGestion(recibos: ReciboGestion[]): ReciboGestion[] {
  return [...recibos].sort(
    (a, b) =>
      ORDEN[a.estado] - ORDEN[b.estado] ||
      a.familiaEtiqueta.localeCompare(b.familiaEtiqueta, 'es-ES') ||
      a.id.localeCompare(b.id)
  )
}
