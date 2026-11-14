import { describe, expect, it } from 'vitest'

import {
  filasServicios,
  respuestaDeValor,
  respuestasDeValores,
  respuestasQueCambian,
  sinContestar,
  valoresIniciales,
  type OpcionServicio,
} from '../peticion'

/**
 * Fase 8b — la petición de servicios en la pantalla: solo las opciones que existen, una fila por
 * servicio con alguna, y «sin contestar» con la regla de la base.
 */

const C3 = '00000000-0000-4000-8000-000000000003'
const C5 = '00000000-0000-4000-8000-000000000005'
const CD = '00000000-0000-4000-8000-0000000000dd'
const MD = '00000000-0000-4000-8000-0000000000ad'
const OPCIONES: OpcionServicio[] = [
  {
    conceptoId: MD,
    servicio: 'matinera',
    tipo: 'diario',
    nombre: 'Matinera',
    importeCentimos: 500,
  },
  {
    conceptoId: C3,
    servicio: 'comedor',
    tipo: 'mensual',
    nombre: 'Comedor 3',
    importeCentimos: 15000,
  },
  {
    conceptoId: C5,
    servicio: 'comedor',
    tipo: 'mensual',
    nombre: 'Comedor 5',
    importeCentimos: 17500,
  },
  {
    conceptoId: CD,
    servicio: 'comedor',
    tipo: 'diario',
    nombre: 'Comedor día',
    importeCentimos: 1200,
  },
]

describe('la petición de servicios en la pantalla', () => {
  it('una fila por servicio con alguna opción, en el orden de la base; vespertina no sale', () => {
    const filas = filasServicios(OPCIONES)
    expect(
      filas.map((f) => [f.servicio, f.mensuales.map((o) => o.conceptoId), f.diarios.length])
    ).toEqual([
      ['comedor', [C3, C5], 1],
      ['matinera', [], 1],
    ])
  })

  it('una respuesta solo vale si es una opción de su fila', () => {
    const [comedor, matinera] = filasServicios(OPCIONES)
    expect(respuestaDeValor(comedor!, `mensual:${C5}`)).toEqual({
      servicio: 'comedor',
      respuesta: 'mensual',
      concepto_id: C5,
    })
    expect(respuestaDeValor(comedor!, 'no')).toEqual({
      servicio: 'comedor',
      respuesta: 'no',
      concepto_id: null,
    })
    // La matinera no tiene mensual; el diario no es una mensual; un concepto de otra fila, tampoco.
    expect(respuestaDeValor(matinera!, `mensual:${MD}`)).toBeNull()
    expect(respuestaDeValor(comedor!, `mensual:${CD}`)).toBeNull()
    expect(respuestaDeValor(matinera!, `dias_sueltos:${CD}`)).toBeNull()
  })

  it('sin contestar: lo que falta y lo que ya no se ofrece; contestado todo, nada', () => {
    const filas = filasServicios(OPCIONES)
    expect(sinContestar(filas, [])).toEqual(['comedor', 'matinera'])
    const todo = [
      { servicio: 'comedor' as const, respuesta: 'mensual' as const, concepto_id: C3 },
      { servicio: 'matinera' as const, respuesta: 'no' as const, concepto_id: null },
    ]
    expect(sinContestar(filas, todo)).toEqual([])
    // El centro quita la mensual de 3 días: esa respuesta ya no es una opción.
    const sinC3 = filasServicios(OPCIONES.filter((o) => o.conceptoId !== C3))
    expect(sinContestar(sinC3, todo)).toEqual(['comedor'])
    expect(valoresIniciales(sinC3, todo)).toEqual({ matinera: 'no' })
  })

  it('de los botones a las respuestas, y solo lo que cambia', () => {
    const filas = filasServicios(OPCIONES)
    const r = respuestasDeValores(filas, {
      comedor: `mensual:${C5}`,
      matinera: `dias_sueltos:${MD}`,
    })
    expect(r).toEqual([
      { servicio: 'comedor', respuesta: 'mensual', concepto_id: C5 },
      { servicio: 'matinera', respuesta: 'dias_sueltos', concepto_id: MD },
    ])
    const guardadas = [
      { servicio: 'comedor' as const, respuesta: 'mensual' as const, concepto_id: C3 },
      r[1]!,
    ]
    expect(respuestasQueCambian(guardadas, r)).toEqual([r[0]])
    expect(respuestasQueCambian(r, r)).toEqual([])
  })
})
