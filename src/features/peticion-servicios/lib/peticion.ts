import { Constants, type Database } from '@/types/db'

/**
 * Fase 8b — la petición de servicios del alta (`docs/specs/altas-serie.md`, «8b»). Una fila por
 * cada servicio que el centro tiene en Cuotas, con No / Todos los meses / Días sueltos. Es una
 * PETICIÓN (tabla `peticion_servicio`): la familia nunca escribe en la facturación. Lo que se ofrece
 * lo dice la base (`servicios_alta`): solo las opciones que existen, con el precio del concepto.
 */

export type Servicio = Database['public']['Enums']['servicio_diario']
export type RespuestaTipo = 'no' | 'mensual' | 'dias_sueltos'

/** El orden de los servicios es el del enum de la base (comedor, matinera, vespertina). */
export const SERVICIOS: readonly Servicio[] = Constants.public.Enums.servicio_diario

/** Una opción que el centro ofrece: un concepto de servicio, mensual o diario, con su precio. */
export interface OpcionServicio {
  conceptoId: string
  servicio: Servicio
  tipo: 'mensual' | 'diario'
  nombre: string
  /** El precio para este niño (tarifa de su año si la hay, si no la base). NULL si no tiene. */
  importeCentimos: number | null
}

/** Lo que contesta la familia para un servicio. `concepto_id` es NULL si y solo si es «no». */
export interface RespuestaServicio {
  servicio: Servicio
  respuesta: RespuestaTipo
  concepto_id: string | null
}

/** Una fila de la pantalla: un servicio con sus mensuales y sus diarios. */
export interface FilaServicio {
  servicio: Servicio
  mensuales: OpcionServicio[]
  diarios: OpcionServicio[]
}

/** Las filas, en el orden de los servicios, solo de los servicios con alguna opción. */
export function filasServicios(opciones: readonly OpcionServicio[]): FilaServicio[] {
  return SERVICIOS.flatMap((servicio) => {
    const deEste = opciones.filter((o) => o.servicio === servicio)
    if (deEste.length === 0) return []
    return [
      {
        servicio,
        mensuales: deEste.filter((o) => o.tipo === 'mensual'),
        diarios: deEste.filter((o) => o.tipo === 'diario'),
      },
    ]
  })
}

/**
 * El valor de una opción en el grupo de botones de su fila: `no`, `mensual:<concepto>` o
 * `dias_sueltos:<concepto>`. Va el concepto porque un servicio puede tener dos mensuales.
 */
export function valorDe(r: Pick<RespuestaServicio, 'respuesta' | 'concepto_id'>): string {
  return r.respuesta === 'no' ? 'no' : `${r.respuesta}:${r.concepto_id}`
}

/** La respuesta de un valor del grupo de botones, o null si no es de ninguna opción de la fila. */
export function respuestaDeValor(fila: FilaServicio, valor: string): RespuestaServicio | null {
  if (valor === 'no') return { servicio: fila.servicio, respuesta: 'no', concepto_id: null }
  const [tipo, id] = valor.split(':')
  const opciones = tipo === 'mensual' ? fila.mensuales : tipo === 'dias_sueltos' ? fila.diarios : []
  if (!opciones.some((o) => o.conceptoId === id)) return null
  return { servicio: fila.servicio, respuesta: tipo as RespuestaTipo, concepto_id: id! }
}

/**
 * Los servicios ofrecidos que no tienen respuesta, o cuya respuesta ya no es una opción de su fila
 * (el centro quitó el concepto). Es la regla de la base (`privado.servicios_sin_contestar`) más
 * la segunda mitad, que la base no mira al cerrar porque la comprobó al guardar.
 */
export function sinContestar(
  filas: readonly FilaServicio[],
  respuestas: readonly RespuestaServicio[]
): Servicio[] {
  return filas
    .filter((f) => {
      const r = respuestas.find((x) => x.servicio === f.servicio)
      return !r || respuestaDeValor(f, valorDe(r)) === null
    })
    .map((f) => f.servicio)
}

/** Solo las respuestas que cambian respecto a lo guardado (la cola no encola lo que no cambia). */
export function respuestasQueCambian(
  guardadas: readonly RespuestaServicio[],
  nuevas: readonly RespuestaServicio[]
): RespuestaServicio[] {
  return nuevas.filter((n) => {
    const g = guardadas.find((x) => x.servicio === n.servicio)
    return !g || g.respuesta !== n.respuesta || g.concepto_id !== n.concepto_id
  })
}

/** Los valores de los grupos de botones a partir de lo guardado (solo los que siguen ofreciéndose). */
export function valoresIniciales(
  filas: readonly FilaServicio[],
  respuestas: readonly RespuestaServicio[]
): Partial<Record<Servicio, string>> {
  const valores: Partial<Record<Servicio, string>> = {}
  for (const f of filas) {
    const r = respuestas.find((x) => x.servicio === f.servicio)
    if (r && respuestaDeValor(f, valorDe(r))) valores[f.servicio] = valorDe(r)
  }
  return valores
}

/** Las respuestas de los valores elegidos, en el orden de las filas (las sin contestar, fuera). */
export function respuestasDeValores(
  filas: readonly FilaServicio[],
  valores: Partial<Record<Servicio, string>>
): RespuestaServicio[] {
  return filas.flatMap((f) => {
    const v = valores[f.servicio]
    const r = v ? respuestaDeValor(f, v) : null
    return r ? [r] : []
  })
}
