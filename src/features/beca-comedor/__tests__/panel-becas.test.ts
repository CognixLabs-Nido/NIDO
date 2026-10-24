import { describe, expect, it } from 'vitest'

import { mesKey } from '../lib/meses'
import {
  aplicado,
  construirPanel,
  queda,
  type AlumnoPanel,
  type DesbordePanel,
  type EntradaPanel,
  type FilaPanel,
  type LineaBecaPanel,
  type ReciboPanel,
  type TotalesBeca,
  type TramoPanel,
} from '../lib/panel-becas'

const MESES = [
  { anio: 2026, mes: 9 },
  { anio: 2026, mes: 10 },
  { anio: 2026, mes: 11 },
]

const A = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000002'
const C = 'c0000000-0000-4000-8000-000000000003'

function alumno(id: string, nombre: string, extra: Partial<AlumnoPanel> = {}): AlumnoPanel {
  return { id, nombre, becado: true, matriculado: true, ...extra }
}

let n = 0
function tramo(
  nino: string,
  mesCorr: number,
  mesAplic: number,
  importe: number,
  extra: Partial<TramoPanel> = {}
): TramoPanel {
  n += 1
  return {
    id: `t${n}`,
    nino_id: nino,
    anio_correspondiente: 2026,
    mes_correspondiente: mesCorr,
    anio_aplicacion: 2026,
    mes_aplicacion: mesAplic,
    importe_centimos: importe,
    estado: 'pendiente',
    origen: 'normal',
    aplicada_en_recibo_id: null,
    ...extra,
  }
}

function recibo(id: string, mes: number, estado = 'borrador'): ReciboPanel {
  return { id, estado, anio: 2026, mes }
}

function linea(t: TramoPanel, r: ReciboPanel): LineaBecaPanel {
  return { beca_tramo_id: t.id, recibo_id: r.id }
}

/** Marca un tramo como el PR-5 al validar su recibo. */
function aplicada(t: TramoPanel, r: ReciboPanel): TramoPanel {
  return { ...t, estado: 'aplicada', aplicada_en_recibo_id: r.id }
}

function panel(e: Partial<EntradaPanel>) {
  return construirPanel({
    meses: MESES,
    alumnos: [],
    tramos: [],
    lineas: [],
    recibos: [],
    desbordes: [],
    ...e,
  })
}

function fila(p: ReturnType<typeof panel>, id: string): FilaPanel {
  const f = p.filas.find((x) => x.id === id)
  if (!f) throw new Error(`sin fila ${id}`)
  return f
}

/** Cuadre: toda la beca del curso está aplicada o queda; nada se pierde ni se cuenta dos veces. */
function cuadra(t: TotalesBeca) {
  expect(aplicado(t) + queda(t)).toBe(t.asignado)
}

describe('construirPanel — filas', () => {
  it('premisa: un becado sin ninguna beca sale, con todo a cero', () => {
    const p = panel({ alumnos: [alumno(A, 'Niño Demo 1')] })
    expect(p.filas).toHaveLength(1)
    expect(fila(p, A).meses).toEqual({})
    expect(fila(p, A).totales).toEqual({
      asignado: 0,
      descontado: 0,
      enRecibo: 0,
      porAplicar: 0,
      transferencia: 0,
      porResolver: 0,
    })
  })

  it('sale también quien ya no es becado pero tiene una beca en el curso; quien no tiene ninguna, no', () => {
    const p = panel({
      alumnos: [
        alumno(A, 'Niño Demo 1', { becado: false }),
        alumno(B, 'Niño Demo 2', { becado: false }),
      ],
      tramos: [tramo(A, 9, 10, 5000)],
    })
    expect(p.filas.map((f) => f.id)).toEqual([A])
    expect(fila(p, A).becado).toBe(false)
  })

  it('ordena por nombre y guarda la beca normal en su mes correspondiente', () => {
    const t = tramo(A, 10, 11, 4000)
    const p = panel({
      alumnos: [alumno(A, 'Zoe Demo'), alumno(B, 'Ana Demo')],
      tramos: [t],
    })
    expect(p.filas.map((f) => f.nombre)).toEqual(['Ana Demo', 'Zoe Demo'])
    expect(fila(p, A).meses[mesKey(2026, 10)]).toMatchObject({
      tramoId: t.id,
      importeCentimos: 4000,
      mesAplicacion: 11,
    })
  })
})

describe('construirPanel — estado de cada beca', () => {
  it('sin línea: por aplicar, en su mes de aplicación', () => {
    const p = panel({ alumnos: [alumno(A, 'Niño Demo 1')], tramos: [tramo(A, 9, 10, 5000)] })
    const b = fila(p, A).meses[mesKey(2026, 9)]
    expect(b?.estado).toBe('por_aplicar')
    expect(fila(p, A).totales).toMatchObject({ asignado: 5000, porAplicar: 5000 })
    expect(queda(fila(p, A).totales)).toBe(5000)
  })

  it('con su línea en el borrador: en recibo sin validar, todavía no aplicada', () => {
    const t = tramo(A, 9, 10, 5000)
    const r = recibo('r1', 10)
    const p = panel({
      alumnos: [alumno(A, 'Niño Demo 1')],
      tramos: [t],
      lineas: [linea(t, r)],
      recibos: [r],
    })
    expect(fila(p, A).meses[mesKey(2026, 9)]?.estado).toBe('en_recibo')
    expect(aplicado(fila(p, A).totales)).toBe(0)
    expect(fila(p, A).totales.enRecibo).toBe(5000)
  })

  it('aplicada (recibo validado): descontada, en el mes de ese recibo', () => {
    const r = recibo('r1', 11, 'pendiente_procesar')
    const t = aplicada(tramo(A, 9, 11, 5000), r)
    const p = panel({
      alumnos: [alumno(A, 'Niño Demo 1')],
      tramos: [t],
      lineas: [linea(t, r)],
      recibos: [r],
    })
    const b = fila(p, A).meses[mesKey(2026, 9)]
    expect(b).toMatchObject({ estado: 'descontada', mesAplicacion: 11 })
    expect(aplicado(fila(p, A).totales)).toBe(5000)
    expect(queda(fila(p, A).totales)).toBe(0)
  })

  it('aplicada aunque no se lea su línea: manda el recibo sellado', () => {
    const r = recibo('r1', 10, 'cobrado_manual')
    const t = aplicada(tramo(A, 9, 10, 5000), r)
    const p = panel({ alumnos: [alumno(A, 'Niño Demo 1')], tramos: [t], recibos: [r] })
    expect(fila(p, A).meses[mesKey(2026, 9)]?.estado).toBe('descontada')
  })

  it('una línea en un recibo que no se pasa (esporádico, borrado) no cuenta: por aplicar', () => {
    const t = tramo(A, 9, 10, 5000)
    const p = panel({
      alumnos: [alumno(A, 'Niño Demo 1')],
      tramos: [t],
      lineas: [{ beca_tramo_id: t.id, recibo_id: 'otro' }],
    })
    expect(fila(p, A).meses[mesKey(2026, 9)]?.estado).toBe('por_aplicar')
  })

  it('una anulada se ve pero no suma en ningún total', () => {
    const p = panel({
      alumnos: [alumno(A, 'Niño Demo 1')],
      tramos: [tramo(A, 9, 10, 5000, { estado: 'anulada' }), tramo(A, 10, 10, 3000)],
    })
    expect(fila(p, A).meses[mesKey(2026, 9)]?.estado).toBe('anulada')
    expect(fila(p, A).totales).toMatchObject({ asignado: 3000, porAplicar: 3000 })
  })

  it('los totales del panel son la suma de las filas', () => {
    const r = recibo('r1', 10, 'enviado_banco')
    const t1 = aplicada(tramo(A, 9, 10, 5000), r)
    const p = panel({
      alumnos: [alumno(A, 'Niño Demo 1'), alumno(B, 'Niño Demo 2')],
      tramos: [t1, tramo(B, 9, 10, 3250)],
      lineas: [linea(t1, r)],
      recibos: [r],
    })
    expect(p.totales).toMatchObject({ asignado: 8250, descontado: 5000, porAplicar: 3250 })
  })
})

describe('construirPanel — desborde (la beca no cabe en el recibo)', () => {
  it('por transferencia: el exceso se reparte entre los hermanos por su beca y sale de lo descontado', () => {
    const r = recibo('r1', 10, 'pendiente_procesar')
    const ta = aplicada(tramo(A, 9, 10, 10000), r)
    const tb = aplicada(tramo(B, 9, 10, 5000), r)
    const d: DesbordePanel = {
      recibo_id: r.id,
      estado: 'resuelto',
      via: 'transferencia',
      exceso_centimos: 6000,
    }
    const p = panel({
      alumnos: [alumno(A, 'Niño Demo 1'), alumno(B, 'Niño Demo 2')],
      tramos: [ta, tb],
      lineas: [linea(ta, r), linea(tb, r)],
      recibos: [r],
      desbordes: [d],
    })
    // 6000 en proporción 2:1 → 4000 y 2000 (resto mayor, como el diferido).
    expect(fila(p, A).meses[mesKey(2026, 9)]).toMatchObject({
      excesoCentimos: 4000,
      via: 'transferencia',
    })
    expect(fila(p, B).meses[mesKey(2026, 9)]).toMatchObject({
      excesoCentimos: 2000,
      via: 'transferencia',
    })
    expect(fila(p, A).totales).toMatchObject({ descontado: 6000, transferencia: 4000 })
    expect(aplicado(fila(p, A).totales)).toBe(10000)
    expect(p.totales).toMatchObject({ descontado: 9000, transferencia: 6000 })
    cuadra(fila(p, A).totales)
    cuadra(fila(p, B).totales)
    cuadra(p.totales)
  })

  it('diferido: lo que no cupo vuelve como tramo resto y no se cuenta dos veces', () => {
    const r = recibo('r1', 10, 'pendiente_procesar')
    const t = aplicada(tramo(A, 9, 10, 10000), r)
    // El tramo resto que crea «Diferir»: mes correspondiente = el del recibo, aplicación = el siguiente.
    const resto = tramo(A, 10, 11, 4000, { origen: 'resto' })
    const d: DesbordePanel = {
      recibo_id: r.id,
      estado: 'resuelto',
      via: 'reducir',
      exceso_centimos: 4000,
    }
    const p = panel({
      alumnos: [alumno(A, 'Niño Demo 1')],
      tramos: [t, resto],
      lineas: [linea(t, r)],
      recibos: [r],
      desbordes: [d],
    })
    const f = fila(p, A)
    expect(f.meses[mesKey(2026, 9)]).toMatchObject({ excesoCentimos: 4000, via: 'diferido' })
    // El resto no es otra beca del mes: va aparte, y no suma en lo asignado.
    expect(f.meses[mesKey(2026, 10)]).toBeUndefined()
    expect(f.restos).toHaveLength(1)
    expect(f.totales).toMatchObject({ asignado: 10000, descontado: 6000, porAplicar: 4000 })
    cuadra(f.totales)
  })

  it('diferido y después descontado el resto: toda la beca aplicada', () => {
    const r1 = recibo('r1', 10, 'enviado_banco')
    const r2 = recibo('r2', 11, 'pendiente_procesar')
    const t = aplicada(tramo(A, 9, 10, 10000), r1)
    const resto = aplicada(tramo(A, 10, 11, 4000, { origen: 'resto' }), r2)
    const p = panel({
      alumnos: [alumno(A, 'Niño Demo 1')],
      tramos: [t, resto],
      lineas: [linea(t, r1), linea(resto, r2)],
      recibos: [r1, r2],
      desbordes: [{ recibo_id: r1.id, estado: 'resuelto', via: 'reducir', exceso_centimos: 4000 }],
    })
    expect(fila(p, A).totales).toMatchObject({ descontado: 10000, porAplicar: 0 })
    cuadra(fila(p, A).totales)
  })

  it('sin resolver (en el borrador): lo que cabe está en el recibo y el exceso, sin resolver', () => {
    const r = recibo('r1', 10)
    const t = tramo(A, 9, 10, 10000)
    const p = panel({
      alumnos: [alumno(A, 'Niño Demo 1')],
      tramos: [t],
      lineas: [linea(t, r)],
      recibos: [r],
      desbordes: [{ recibo_id: r.id, estado: 'pendiente', via: null, exceso_centimos: 2500 }],
    })
    expect(fila(p, A).meses[mesKey(2026, 9)]).toMatchObject({
      estado: 'en_recibo',
      excesoCentimos: 2500,
      via: 'por_resolver',
    })
    expect(fila(p, A).totales).toMatchObject({ enRecibo: 7500, porResolver: 2500 })
    expect(p.totales.porResolver).toBe(2500)
    cuadra(fila(p, A).totales)
  })

  it('dentro de un alumno, lo que no cupo son sus últimas becas en el orden del motor', () => {
    const r = recibo('r1', 10, 'pendiente_procesar')
    const sep = aplicada(tramo(A, 9, 10, 3000), r)
    const oct = aplicada(tramo(A, 10, 10, 5000), r)
    const p = panel({
      alumnos: [alumno(A, 'Niño Demo 1')],
      tramos: [oct, sep],
      lineas: [linea(sep, r), linea(oct, r)],
      recibos: [r],
      desbordes: [
        { recibo_id: r.id, estado: 'resuelto', via: 'transferencia', exceso_centimos: 6000 },
      ],
    })
    expect(fila(p, A).meses[mesKey(2026, 10)]?.excesoCentimos).toBe(5000)
    expect(fila(p, A).meses[mesKey(2026, 9)]?.excesoCentimos).toBe(1000)
    cuadra(fila(p, A).totales)
  })

  it('un desborde de otro recibo no toca a quien no está en él', () => {
    const r1 = recibo('r1', 10, 'pendiente_procesar')
    const r2 = recibo('r2', 10, 'pendiente_procesar')
    const ta = aplicada(tramo(A, 9, 10, 10000), r1)
    const tc = aplicada(tramo(C, 9, 10, 10000), r2)
    const p = panel({
      alumnos: [alumno(A, 'Niño Demo 1'), alumno(C, 'Niño Demo 3')],
      tramos: [ta, tc],
      lineas: [linea(ta, r1), linea(tc, r2)],
      recibos: [r1, r2],
      desbordes: [
        { recibo_id: r1.id, estado: 'resuelto', via: 'transferencia', exceso_centimos: 1000 },
      ],
    })
    expect(fila(p, C).meses[mesKey(2026, 9)]?.excesoCentimos).toBe(0)
    expect(fila(p, C).totales.descontado).toBe(10000)
  })
})
