// PR-11 — Panel de becas: por alumno, qué beca comedor tiene, cuánto, qué se ha descontado y
// qué queda. Puro y sin dependencias (testeable). Céntimos enteros en todo.
//
// De dónde sale cada estado (sin columnas nuevas: todo lo escriben el motor y el PR-5):
//   · descontada  → el tramo está `aplicada`: su línea está en un recibo validado.
//   · en_recibo   → pendiente, pero su línea (`lineas_recibo.beca_tramo_id`) ya está en el
//                   BORRADOR del mes: se descontará al validarlo.
//   · por_aplicar → pendiente y sin línea: espera a que se genere su mes de aplicación.
//
// El DESBORDE: si la beca supera la cuota del recibo familiar, el motor descuenta solo lo que
// cabe y el exceso se resuelve aparte (diferido a tramos `resto` del mes siguiente, o devuelto
// por transferencia). Sumar los tramos tal cual contaría dos veces lo diferido, así que el
// exceso se le quita a la beca de ese recibo y se reparte entre los hijos con la misma regla
// con la que se difiere (`repartirExceso`, resto mayor). Dentro de un hijo, lo que no cupo
// son sus últimos tramos en el orden del motor.

import { mesKey } from './meses'
import { repartirExceso } from './reparto-desborde'
import type { MesCurso } from './cargas'

export const ESTADOS_BECA = ['descontada', 'en_recibo', 'por_aplicar', 'anulada'] as const
export type EstadoBeca = (typeof ESTADOS_BECA)[number]

/** Cómo se resolvió el exceso de un recibo. `por_resolver` = desborde aún pendiente. */
export const VIAS_EXCESO = ['diferido', 'transferencia', 'por_resolver'] as const
export type ViaExceso = (typeof VIAS_EXCESO)[number]

export interface TramoPanel {
  id: string
  nino_id: string
  anio_correspondiente: number
  mes_correspondiente: number
  anio_aplicacion: number
  mes_aplicacion: number
  importe_centimos: number
  estado: 'pendiente' | 'aplicada' | 'anulada'
  origen: 'normal' | 'resto'
  aplicada_en_recibo_id: string | null
}

/** Línea de beca de un recibo vivo y regular: qué tramo descuenta y en qué recibo. */
export interface LineaBecaPanel {
  beca_tramo_id: string
  recibo_id: string
}

export interface ReciboPanel {
  id: string
  estado: string
  anio: number
  mes: number
}

export interface DesbordePanel {
  recibo_id: string
  estado: 'pendiente' | 'resuelto'
  via: 'reducir' | 'transferencia' | 'resto' | null
  exceso_centimos: number
}

export interface AlumnoPanel {
  id: string
  nombre: string
  /** Beca comedor ACTIVA en el curso. */
  becado: boolean
  /** Matrícula activa en el curso: sin ella, el motor no le aplica ningún tramo. */
  matriculado: boolean
}

export interface BecaMes {
  tramoId: string
  anioCorrespondiente: number
  mesCorrespondiente: number
  /** Mes del recibo donde se descuenta (o se descontará). */
  anioAplicacion: number
  mesAplicacion: number
  importeCentimos: number
  estado: EstadoBeca
  /** Parte del importe que no cupo en el recibo (desborde). */
  excesoCentimos: number
  via: ViaExceso | null
}

export interface TotalesBeca {
  /** Suma de las becas del curso (tramos normales, sin anuladas). */
  asignado: number
  descontado: number
  enRecibo: number
  porAplicar: number
  /** Exceso devuelto (o por devolver) a la familia por transferencia. */
  transferencia: number
  /** Exceso de un desborde que aún no se ha resuelto. */
  porResolver: number
}

export interface FilaPanel extends AlumnoPanel {
  /** Las becas normales, por `mesKey` del mes correspondiente. */
  meses: Record<string, BecaMes>
  /** Los tramos `resto`: lo diferido de un desborde, que se descuenta en otro mes. */
  restos: BecaMes[]
  totales: TotalesBeca
}

export interface PanelBecas {
  meses: MesCurso[]
  filas: FilaPanel[]
  totales: TotalesBeca
}

export interface EntradaPanel {
  meses: MesCurso[]
  alumnos: AlumnoPanel[]
  tramos: TramoPanel[]
  lineas: LineaBecaPanel[]
  recibos: ReciboPanel[]
  desbordes: DesbordePanel[]
}

/** Lo ya aplicado: descontado en un recibo validado, o devuelto por transferencia. */
export function aplicado(t: TotalesBeca): number {
  return t.descontado + t.transferencia
}

/** Lo que queda: en el borrador, por aplicar (también lo diferido) y el exceso sin resolver. */
export function queda(t: TotalesBeca): number {
  return t.enRecibo + t.porAplicar + t.porResolver
}

function cero(): TotalesBeca {
  return {
    asignado: 0,
    descontado: 0,
    enRecibo: 0,
    porAplicar: 0,
    transferencia: 0,
    porResolver: 0,
  }
}

function viaDe(d: DesbordePanel): ViaExceso {
  if (d.estado === 'pendiente' || d.via == null) return 'por_resolver'
  return d.via === 'transferencia' ? 'transferencia' : 'diferido'
}

/** Orden del motor (PASE 2-bis): mes correspondiente, después alumno. */
function ordenMotor(a: TramoPanel, b: TramoPanel): number {
  return (
    a.anio_correspondiente - b.anio_correspondiente ||
    a.mes_correspondiente - b.mes_correspondiente ||
    a.nino_id.localeCompare(b.nino_id)
  )
}

/**
 * El exceso de cada recibo con desborde, por tramo: se reparte entre los hijos por su beca en
 * ese recibo (resto mayor, como el diferido) y, dentro de cada hijo, cae en sus últimos tramos.
 */
function excesoPorTramo(
  tramosDeRecibo: Map<string, TramoPanel[]>,
  desbordes: DesbordePanel[]
): Map<string, { centimos: number; via: ViaExceso }> {
  const out = new Map<string, { centimos: number; via: ViaExceso }>()
  for (const d of desbordes) {
    const tramos = [...(tramosDeRecibo.get(d.recibo_id) ?? [])].sort(ordenMotor)
    const becaPorNino = new Map<string, number>()
    for (const t of tramos) {
      becaPorNino.set(t.nino_id, (becaPorNino.get(t.nino_id) ?? 0) + t.importe_centimos)
    }
    const reparto = repartirExceso(
      d.exceso_centimos,
      [...becaPorNino].map(([ninoId, becaCentimos]) => ({ ninoId, becaCentimos }))
    )
    const via = viaDe(d)
    for (const { ninoId, restoCentimos } of reparto) {
      let falta = restoCentimos
      for (const t of tramos.filter((x) => x.nino_id === ninoId).reverse()) {
        if (falta <= 0) break
        const parte = Math.min(falta, t.importe_centimos)
        out.set(t.id, { centimos: parte, via })
        falta -= parte
      }
    }
  }
  return out
}

/**
 * Construye el panel: una fila por alumno (becados y cualquiera con una beca en el curso),
 * ordenada por nombre, con su beca de cada mes, lo diferido y los totales.
 */
export function construirPanel(e: EntradaPanel): PanelBecas {
  const recibos = new Map(e.recibos.map((r) => [r.id, r]))
  const tramosPorId = new Map(e.tramos.map((t) => [t.id, t]))

  // Recibo de cada tramo: el sellado al validar, o el de su línea (borrador).
  const reciboDeTramo = new Map<string, ReciboPanel>()
  for (const l of e.lineas) {
    const r = recibos.get(l.recibo_id)
    if (r && tramosPorId.has(l.beca_tramo_id)) reciboDeTramo.set(l.beca_tramo_id, r)
  }
  for (const t of e.tramos) {
    const r = t.aplicada_en_recibo_id ? recibos.get(t.aplicada_en_recibo_id) : undefined
    if (r) reciboDeTramo.set(t.id, r)
  }

  const tramosDeRecibo = new Map<string, TramoPanel[]>()
  for (const t of e.tramos) {
    const r = t.estado === 'anulada' ? undefined : reciboDeTramo.get(t.id)
    if (r) tramosDeRecibo.set(r.id, [...(tramosDeRecibo.get(r.id) ?? []), t])
  }
  const exceso = excesoPorTramo(tramosDeRecibo, e.desbordes)

  const alumnos = new Map(e.alumnos.map((a) => [a.id, a]))
  const filas = new Map<string, FilaPanel>()
  function filaDe(ninoId: string): FilaPanel {
    let f = filas.get(ninoId)
    if (!f) {
      const a = alumnos.get(ninoId) ?? { id: ninoId, nombre: '', becado: false, matriculado: false }
      f = { ...a, meses: {}, restos: [], totales: cero() }
      filas.set(ninoId, f)
    }
    return f
  }
  for (const a of e.alumnos) if (a.becado) filaDe(a.id)

  const total = cero()
  for (const t of e.tramos) {
    const fila = filaDe(t.nino_id)
    const r = reciboDeTramo.get(t.id)
    const estado: EstadoBeca =
      t.estado === 'anulada'
        ? 'anulada'
        : t.estado === 'aplicada' || (r != null && r.estado !== 'borrador')
          ? 'descontada'
          : r != null
            ? 'en_recibo'
            : 'por_aplicar'
    const ex = exceso.get(t.id)
    const beca: BecaMes = {
      tramoId: t.id,
      anioCorrespondiente: t.anio_correspondiente,
      mesCorrespondiente: t.mes_correspondiente,
      anioAplicacion: r?.anio ?? t.anio_aplicacion,
      mesAplicacion: r?.mes ?? t.mes_aplicacion,
      importeCentimos: t.importe_centimos,
      estado,
      excesoCentimos: ex?.centimos ?? 0,
      via: ex?.via ?? null,
    }
    if (t.origen === 'normal') {
      fila.meses[mesKey(t.anio_correspondiente, t.mes_correspondiente)] = beca
    } else {
      fila.restos.push(beca)
    }
    if (estado === 'anulada') continue

    for (const tot of [fila.totales, total]) {
      if (t.origen === 'normal') tot.asignado += t.importe_centimos
      const cabe = t.importe_centimos
      if (estado === 'descontada') tot.descontado += cabe
      else if (estado === 'en_recibo') tot.enRecibo += cabe
      else tot.porAplicar += cabe
      // Lo diferido no se suma aquí: vuelve como tramo `resto`, que cuenta por sí mismo.
      if (beca.via === 'transferencia') tot.transferencia += beca.excesoCentimos
      else if (beca.via === 'por_resolver') tot.porResolver += beca.excesoCentimos
    }
  }

  for (const f of filas.values()) {
    f.restos.sort(
      (a, b) =>
        a.anioAplicacion - b.anioAplicacion ||
        a.mesAplicacion - b.mesAplicacion ||
        a.tramoId.localeCompare(b.tramoId)
    )
  }

  return {
    meses: e.meses,
    filas: [...filas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    totales: total,
  }
}
