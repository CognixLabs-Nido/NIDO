// Histórico de recibos de UNA familia para Dirección (F-6): cada recibo con su estado y lo que le
// pasó al cobrarlo. Puro y sin dependencias (Supabase queda en la query): testeable como función.
//
// El estado de la BD no basta para contestar «¿qué le hemos cobrado?»:
//  - un validado puede estar ya en una remesa (`recibos_remesa` a una remesa viva);
//  - una devolución cobrada en efectivo o por transferencia queda `cobrado_manual` (PR-2), y la
//    llevada al banco o al siguiente recibo sigue `devuelto`, con el dinero en OTRO recibo;
//  - un cheque menor que el recibo deja la diferencia en un esporádico aparte (PR-1b), y uno mayor
//    un sobrante que se difiere al recibo siguiente o se devuelve por transferencia (PR-1c).
// Por eso cada fila lleva sus enlaces a los recibos de los que viene o a los que fue su dinero.

import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']
type MetodoPago = Database['public']['Enums']['metodo_pago']

/** Las salidas de una devolución (CHECK `recibos_devolucion_salida`). */
export type SalidaDevolucionHistorial = 'banco' | 'efectivo' | 'transferencia' | 'siguiente_recibo'

/**
 * El estado que se enseña. `enviado_banco` no se llama «cobrado»: NIDO no sabe que el banco lo
 * cobró, solo que no ha llegado devolución.
 */
export type EstadoHistorial =
  | 'borrador'
  | 'validado'
  | 'en_remesa'
  | 'enviado_banco'
  | 'devuelto'
  | 'cobrado'

/** Los tipos de recibo del histórico (el catálogo que recorre el test de claves). */
export const TIPOS_RECIBO_HISTORIAL = [
  'mensual',
  'esporadico',
  'regiro',
  'diferencia_cheque',
] as const
export type TipoReciboHistorial = (typeof TIPOS_RECIBO_HISTORIAL)[number]

/** Un recibo de la familia en un mes, para enlazarlo. */
export interface ReferenciaRecibo {
  reciboId: string
  anio: number
  mes: number
}

export interface ReciboHistorialInput {
  id: string
  anio: number
  mes: number
  estado: EstadoRecibo
  metodo: MetodoPago | null
  total_centimos: number
  es_esporadico: boolean
  concepto_esporadico: string | null
  devuelto_de_recibo_id: string | null
  diferencia_de_recibo_id: string | null
  fecha_envio_banco: string | null
  fecha_devolucion: string | null
  devolucion_gastos_centimos: number | null
  devolucion_salida: string | null
  cobro_forma: MetodoPago | null
  cobro_fecha: string | null
  cobro_nota: string | null
  cobro_importe_centimos: number | null
  created_at: string
}

/** El enlace de un recibo a una remesa VIVA (las borradas no cuentan: el recibo quedó libre). */
export interface EnlaceRemesaInput {
  reciboId: string
  anio: number
  mes: number
  estado: Database['public']['Enums']['estado_remesa']
}

/** Una línea que trae dinero de otro recibo: una devolución arrastrada o el sobrante de un cheque. */
export interface LineaEnlazadaInput {
  reciboId: string
  importeCentimos: number
  arrastreDeReciboId: string | null
  sobranteDeDesbordeId: string | null
}

/** El sobrante de un cheque (`beca_comedor_desborde` con `origen = 'cheque'`). */
export interface SobranteChequeInput {
  id: string
  reciboId: string
  excesoCentimos: number
  estado: string
  via: string | null
}

export interface CobroHistorial {
  forma: MetodoPago | null
  fecha: string | null
  nota: string | null
  /** Solo con cheque guardería / ticket restaurant: lo que valía el cheque. */
  chequeCentimos: number | null
}

export interface SobranteHistorial {
  excesoCentimos: number
  resueltoPor: 'diferir' | 'transferencia' | null
  /** Diferido: el recibo que lleva la línea de saldo a favor (null si se quitó). */
  diferidoA: ReferenciaRecibo | null
}

export interface DevolucionHistorial {
  fecha: string | null
  gastosCentimos: number
  /** Lo que se debe por la devolución: el recibo más los gastos del banco. */
  importeCentimos: number
  salida: SalidaDevolucionHistorial | null
  /** Salida banco: el recibo de re-giro. Salida siguiente_recibo: el que lleva la línea. */
  llevadaA: ReferenciaRecibo | null
}

export interface ReciboHistorial {
  id: string
  anio: number
  mes: number
  tipo: TipoReciboHistorial
  concepto: string | null
  totalCentimos: number
  metodo: MetodoPago | null
  estado: EstadoHistorial
  /** En una remesa viva: de qué mes es y si ya se envió. */
  remesa: { anio: number; mes: number; enviada: boolean } | null
  fechaEnvioBanco: string | null
  /** Cobrado a mano (también la devolución cobrada en efectivo o por transferencia). */
  cobro: CobroHistorial | null
  /** Cheque menor que el recibo: el esporádico con la diferencia. */
  diferencia: (ReferenciaRecibo & { totalCentimos: number }) | null
  /** Cheque mayor que el recibo: el sobrante y adónde fue. */
  sobrante: SobranteHistorial | null
  devolucion: DevolucionHistorial | null
  /** Re-giro o diferencia de cheque: el recibo del que nace. */
  origen: ReferenciaRecibo | null
  /** Las líneas que traen dinero de otro recibo de la familia. */
  incluye: Array<ReferenciaRecibo & { tipo: 'devolucion' | 'sobrante'; importeCentimos: number }>
}

const SALIDAS: readonly string[] = ['banco', 'efectivo', 'transferencia', 'siguiente_recibo']

function salidaDe(valor: string | null): SalidaDevolucionHistorial | null {
  return valor != null && SALIDAS.includes(valor) ? (valor as SalidaDevolucionHistorial) : null
}

function estadoDe(r: ReciboHistorialInput, enRemesa: boolean): EstadoHistorial {
  switch (r.estado) {
    case 'borrador':
      return 'borrador'
    case 'pendiente_procesar':
      return enRemesa ? 'en_remesa' : 'validado'
    case 'enviado_banco':
      return 'enviado_banco'
    case 'devuelto':
      return 'devuelto'
    case 'cobrado_manual':
      return 'cobrado'
  }
}

function tipoDe(r: ReciboHistorialInput): TipoReciboHistorial {
  if (r.devuelto_de_recibo_id != null) return 'regiro'
  if (r.diferencia_de_recibo_id != null) return 'diferencia_cheque'
  return r.es_esporadico ? 'esporadico' : 'mensual'
}

/**
 * Construye el histórico. Orden: el período más reciente arriba y, dentro del mes, el mensual
 * antes que los esporádicos; desempate por creación (el último, arriba) y por id.
 *
 * Los enlaces se resuelven solo dentro de los recibos recibidos: uno que apunte fuera (borrado o
 * de otra familia) se queda sin enlace en vez de inventarlo.
 */
export function construirHistorial(input: {
  recibos: ReciboHistorialInput[]
  enlacesRemesa: EnlaceRemesaInput[]
  lineasEnlazadas: LineaEnlazadaInput[]
  sobrantes: SobranteChequeInput[]
}): ReciboHistorial[] {
  const porId = new Map(input.recibos.map((r) => [r.id, r]))
  const ref = (id: string | null): ReferenciaRecibo | null => {
    const r = id ? porId.get(id) : undefined
    return r ? { reciboId: r.id, anio: r.anio, mes: r.mes } : null
  }

  const remesaPorRecibo = new Map(input.enlacesRemesa.map((e) => [e.reciboId, e]))
  const sobrantePorRecibo = new Map(input.sobrantes.map((s) => [s.reciboId, s]))
  const sobrantePorId = new Map(input.sobrantes.map((s) => [s.id, s]))

  // Recibos que nacen de otro: el re-giro de una devolución y la diferencia de un cheque.
  const regiroDe = new Map<string, string>()
  const diferenciaDe = new Map<string, string>()
  for (const r of input.recibos) {
    if (r.devuelto_de_recibo_id) regiroDe.set(r.devuelto_de_recibo_id, r.id)
    if (r.diferencia_de_recibo_id) diferenciaDe.set(r.diferencia_de_recibo_id, r.id)
  }

  // Líneas que traen dinero de otro recibo, vistas desde los dos lados.
  const arrastradaA = new Map<string, string>()
  const diferidoA = new Map<string, string>()
  const incluyePorRecibo = new Map<string, ReciboHistorial['incluye']>()
  for (const l of input.lineasEnlazadas) {
    let desde: { tipo: 'devolucion' | 'sobrante'; reciboId: string } | null = null
    if (l.arrastreDeReciboId) {
      arrastradaA.set(l.arrastreDeReciboId, l.reciboId)
      desde = { tipo: 'devolucion', reciboId: l.arrastreDeReciboId }
    } else if (l.sobranteDeDesbordeId) {
      const s = sobrantePorId.get(l.sobranteDeDesbordeId)
      if (s) {
        diferidoA.set(s.reciboId, l.reciboId)
        desde = { tipo: 'sobrante', reciboId: s.reciboId }
      }
    }
    const origen = desde ? ref(desde.reciboId) : null
    if (desde && origen) {
      const lista = incluyePorRecibo.get(l.reciboId) ?? []
      lista.push({ ...origen, tipo: desde.tipo, importeCentimos: l.importeCentimos })
      incluyePorRecibo.set(l.reciboId, lista)
    }
  }

  const esMensual = (r: ReciboHistorialInput) => tipoDe(r) === 'mensual'
  const ordenados = [...input.recibos].sort(
    (a, b) =>
      b.anio - a.anio ||
      b.mes - a.mes ||
      Number(esMensual(b)) - Number(esMensual(a)) ||
      b.created_at.localeCompare(a.created_at) ||
      a.id.localeCompare(b.id)
  )

  return ordenados.map((r): ReciboHistorial => {
    const enlace = remesaPorRecibo.get(r.id)
    const salida = salidaDe(r.devolucion_salida)
    const devuelta = r.fecha_devolucion != null || r.estado === 'devuelto'
    const sobrante = sobrantePorRecibo.get(r.id)
    const diferencia = ref(diferenciaDe.get(r.id) ?? null)
    const diferenciaRow = diferencia ? porId.get(diferencia.reciboId) : undefined
    const gastos = r.devolucion_gastos_centimos ?? 0

    return {
      id: r.id,
      anio: r.anio,
      mes: r.mes,
      tipo: tipoDe(r),
      concepto: r.concepto_esporadico,
      totalCentimos: r.total_centimos,
      metodo: r.metodo,
      estado: estadoDe(r, enlace != null),
      remesa: enlace
        ? { anio: enlace.anio, mes: enlace.mes, enviada: enlace.estado === 'enviada' }
        : null,
      fechaEnvioBanco: r.fecha_envio_banco,
      cobro:
        r.estado === 'cobrado_manual'
          ? {
              forma: r.cobro_forma,
              fecha: r.cobro_fecha,
              nota: r.cobro_nota,
              chequeCentimos: r.cobro_importe_centimos,
            }
          : null,
      diferencia:
        diferencia && diferenciaRow
          ? { ...diferencia, totalCentimos: diferenciaRow.total_centimos }
          : null,
      sobrante: sobrante
        ? {
            excesoCentimos: sobrante.excesoCentimos,
            // `reducir` es «diferir», como en el desborde de beca (`resueltoPorDe`).
            resueltoPor:
              sobrante.estado !== 'resuelto'
                ? null
                : sobrante.via === 'transferencia'
                  ? 'transferencia'
                  : 'diferir',
            diferidoA: ref(diferidoA.get(r.id) ?? null),
          }
        : null,
      devolucion: devuelta
        ? {
            fecha: r.fecha_devolucion,
            gastosCentimos: gastos,
            importeCentimos: r.total_centimos + gastos,
            salida,
            llevadaA:
              salida === 'banco'
                ? ref(regiroDe.get(r.id) ?? null)
                : salida === 'siguiente_recibo'
                  ? ref(null)
                  : null,
          }
        : null,
      origen: ref(r.devuelto_de_recibo_id ?? r.diferencia_de_recibo_id),
      incluye: incluyePorRecibo.get(r.id) ?? [],
    }
  })
}
