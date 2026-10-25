import { localeIntl } from '@/shared/lib/locale-intl'
import type { Database } from '@/types/database'

import type { SalidaDevolucion } from '../schemas/remesa'

export type { SalidaDevolucion } from '../schemas/remesa'

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
  /** PR-2: los gastos de la devolución (con fecha_devolucion) y su salida, si ya se resolvió. */
  devolucionGastosCentimos: number | null
  devolucionSalida: SalidaDevolucion | null
  /**
   * PR-14: adónde iría la devolución sin resolver llevada al siguiente recibo (el mes siguiente,
   * con lo que la BD haría allí); null si el recibo no es un devuelto por resolver.
   */
  arrastre: DestinoArrastre | null
  /** PR-14: el recibo al que se arrastró, si su salida es `siguiente_recibo`. */
  arrastradoA: MesRecibo | null
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
  /** PR-1c: el sobrante del cheque mayor que el recibo, si lo hay. */
  sobranteCheque: SobranteCheque | null
}

/**
 * PR-1c: el sobrante de un cheque guardería / ticket restaurant mayor que el recibo (una fila de
 * `beca_comedor_desborde` con origen `cheque`). `resueltoPor` es null mientras está pendiente.
 */
export interface SobranteCheque {
  excesoCentimos: number
  /** El mes del recibo del cheque: diferirlo lo lleva al recibo del mes siguiente. */
  mes: MesRecibo
  resueltoPor: 'diferir' | 'transferencia' | null
}

/** La vía guardada (`reducir` es «diferir», como en el desborde de beca) a la de la pantalla. */
export function resueltoPorDe(fila: {
  estado: string
  via: string | null
}): SobranteCheque['resueltoPor'] {
  if (fila.estado !== 'resuelto') return null
  if (fila.via === 'transferencia') return 'transferencia'
  return 'diferir'
}

/** Un mes de recibo. */
export interface MesRecibo {
  anio: number
  mes: number
}

/** El mes siguiente: diciembre pasa a enero del año siguiente. */
export function mesSiguiente(m: MesRecibo): MesRecibo {
  return m.mes === 12 ? { anio: m.anio + 1, mes: 1 } : { anio: m.anio, mes: m.mes + 1 }
}

/**
 * PR-14: adónde va una devolución llevada al siguiente recibo. Siempre al mes siguiente al del
 * devuelto, sin saltos, con lo mismo que hace allí la BD (`resolver_devolucion`):
 *  - `anadir`: la familia tiene ese mes su recibo en borrador, y la línea entra en él;
 *  - `crear`: no tiene recibo ese mes, y se crea con la línea;
 *  - `recibo_cerrado`: lo tiene ya validado o en remesa, y la salida no se ofrece;
 *  - `mes_cerrado`: no lo tiene y el mes ya está cerrado, y tampoco se ofrece.
 */
export interface DestinoArrastre {
  mes: MesRecibo
  tipo: 'anadir' | 'crear' | 'recibo_cerrado' | 'mes_cerrado'
}

/**
 * @param reciboSiguiente el recibo regular de la familia del mes siguiente, si lo tiene.
 * @param mesSiguienteCerrado si el mes siguiente ya está cerrado (`cierre_mensual`).
 */
export function destinoArrastre(
  devuelto: MesRecibo,
  reciboSiguiente: { estado: EstadoRecibo } | null,
  mesSiguienteCerrado: boolean
): DestinoArrastre {
  const mes = mesSiguiente(devuelto)
  if (reciboSiguiente) {
    return { mes, tipo: reciboSiguiente.estado === 'borrador' ? 'anadir' : 'recibo_cerrado' }
  }
  return { mes, tipo: mesSiguienteCerrado ? 'mes_cerrado' : 'crear' }
}

/** ¿Se ofrece llevarla al siguiente recibo? Solo si hay un borrador donde entrar o se puede crear. */
export function arrastreOfrecido(d: DestinoArrastre): boolean {
  return d.tipo === 'anadir' || d.tipo === 'crear'
}

/** «noviembre de 2026», en el idioma de la página. */
export function etiquetaMes(m: MesRecibo, locale: string): string {
  return new Intl.DateTimeFormat(localeIntl(locale), { month: 'long', year: 'numeric' }).format(
    new Date(m.anio, m.mes - 1, 1)
  )
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
