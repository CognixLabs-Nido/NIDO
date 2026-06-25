import { describe, expect, it } from 'vitest'

import {
  computarPropuesta,
  construirFilasRollover,
  type AulaDestinoRollover,
  type NinoActivoRollover,
  type ResultadoPropuesta,
} from '../proponer'

const AULA_BEBES: AulaDestinoRollover = {
  aula_id: 'a-bebes',
  nombre: 'Bebés',
  tramo_edad: [2025],
  capacidad: 2,
}
const AULA_1A2: AulaDestinoRollover = {
  aula_id: 'a-1a2',
  nombre: '1-2 años',
  tramo_edad: [2024],
  capacidad: 8,
}
const AULA_2A3: AulaDestinoRollover = {
  aula_id: 'a-2a3',
  nombre: '2-3 años',
  tramo_edad: [2023],
  capacidad: 8,
}
const AULAS = [AULA_BEBES, AULA_1A2, AULA_2A3]

function nino(
  id: string,
  anio: number | null,
  aulaOrigen: { id: string; nombre: string } | null = null
): NinoActivoRollover {
  return {
    nino_id: id,
    nombre: `Niño ${id}`,
    apellidos: 'Test',
    fecha_nacimiento: anio === null ? null : `${anio}-03-15`,
    aula_origen_id: aulaOrigen?.id ?? null,
    aula_origen_nombre: aulaOrigen?.nombre ?? null,
  }
}

describe('computarPropuesta', () => {
  it('1 sala candidata por edad → propuesta directa a esa sala', () => {
    const r = computarPropuesta([nino('1', 2024)], AULAS, new Set())
    expect(r.propuestas).toEqual([
      { nino_id: '1', nombre: 'Niño 1', apellidos: 'Test', aula_destino_id: 'a-1a2' },
    ])
    expect(r.requiereEleccion).toHaveLength(0)
    expect(r.graduados).toHaveLength(0)
  })

  it('0 salas por edad (sale de 0-3) → graduado, no se propone', () => {
    // 2022 no está en ningún tramo (las salas cubren 2023-2025).
    const r = computarPropuesta([nino('1', 2022)], AULAS, new Set())
    expect(r.propuestas).toHaveLength(0)
    expect(r.graduados).toEqual([
      { nino_id: '1', nombre: 'Niño 1', apellidos: 'Test', anio_nacimiento: 2022 },
    ])
  })

  it('sin fecha de nacimiento → requiere elección (motivo sin_fecha), candidatas = todas', () => {
    const r = computarPropuesta([nino('1', null)], AULAS, new Set())
    expect(r.requiereEleccion).toHaveLength(1)
    expect(r.requiereEleccion[0]).toMatchObject({ nino_id: '1', motivo: 'sin_fecha_nacimiento' })
    expect(r.requiereEleccion[0]!.candidatas).toEqual(['a-bebes', 'a-1a2', 'a-2a3'])
  })

  it('idempotencia: ignora a los niños que ya tienen matrícula en el destino', () => {
    const r = computarPropuesta([nino('1', 2024), nino('2', 2023)], AULAS, new Set(['1']))
    expect(r.propuestas.map((p) => p.nino_id)).toEqual(['2'])
  })

  it('aviso de aforo: avisa si las propuestas superan la capacidad de la sala', () => {
    // Capacidad de Bebés = 2; proponemos 3 niños de 2025.
    const r = computarPropuesta(
      [nino('1', 2025), nino('2', 2025), nino('3', 2025)],
      AULAS,
      new Set()
    )
    expect(r.propuestas).toHaveLength(3)
    expect(r.avisosAforo).toEqual([
      { aula_id: 'a-bebes', nombre: 'Bebés', capacidad: 2, propuestos: 3 },
    ])
  })

  it('no avisa de aforo si no se supera la capacidad', () => {
    const r = computarPropuesta([nino('1', 2024)], AULAS, new Set())
    expect(r.avisosAforo).toHaveLength(0)
  })

  describe('agrupación por aula de origen (H-2-1)', () => {
    // Dos salas destino candidatas para el MISMO año (2024): Roja y Azul.
    const SALAS_SOLAPAN: AulaDestinoRollover[] = [
      { aula_id: 'd-roja', nombre: 'Roja', tramo_edad: [2024], capacidad: 8 },
      { aula_id: 'd-azul', nombre: 'Azul', tramo_edad: [2024], capacidad: 8 },
    ]
    const NORTE = { id: 'o-norte', nombre: 'Norte' }
    const SUR = { id: 'o-sur', nombre: 'Sur' }

    it('≥2 candidatas → propuesta (no requiere elección); el mismo origen va junto', () => {
      const r = computarPropuesta(
        [nino('1', 2024, NORTE), nino('2', 2024, NORTE), nino('3', 2024, NORTE)],
        SALAS_SOLAPAN,
        new Set()
      )
      expect(r.requiereEleccion).toHaveLength(0)
      expect(r.propuestas).toHaveLength(3)
      const salas = new Set(r.propuestas.map((p) => p.aula_destino_id))
      expect(salas.size).toBe(1) // todos los del Norte a la misma sala
    })

    it('aulas de origen distintas se reparten en candidatas distintas', () => {
      const r = computarPropuesta(
        [nino('1', 2024, NORTE), nino('2', 2024, SUR)],
        SALAS_SOLAPAN,
        new Set()
      )
      const porNino = new Map(r.propuestas.map((p) => [p.nino_id, p.aula_destino_id]))
      // Norte (o-norte) ordena antes que Sur (o-sur) → Norte=d-azul/d-roja[0], Sur=[1].
      expect(porNino.get('1')).not.toEqual(porNino.get('2'))
      // candidatas ordenadas: ['d-azul','d-roja'] → Norte=idx0=d-azul, Sur=idx1=d-roja.
      expect(porNino.get('1')).toBe('d-azul')
      expect(porNino.get('2')).toBe('d-roja')
    })
  })
})

describe('construirFilasRollover', () => {
  const NORTE = { id: 'o-norte', nombre: 'Norte' }

  it('una fila por niño con aula actual y propuesta pre-rellena', () => {
    const ninos = [nino('1', 2024, NORTE), nino('2', 2022, NORTE)]
    const resultado = computarPropuesta(ninos, AULAS, new Set())
    const filas = construirFilasRollover(ninos, resultado, new Map())

    expect(filas).toHaveLength(2)
    const f1 = filas.find((f) => f.nino_id === '1')!
    expect(f1.aula_actual_nombre).toBe('Norte')
    expect(f1.aula_propuesta_id).toBe('a-1a2')
    expect(f1.accion).toBe('continua')

    const f2 = filas.find((f) => f.nino_id === '2')! // 2022 → graduado
    expect(f2.aula_propuesta_id).toBeNull()
    expect(f2.accion).toBe('gradua')
  })

  it('la propuesta persistida (pendiente) tiene prioridad sobre la calculada', () => {
    const ninos = [nino('1', 2024, NORTE)]
    const resultado: ResultadoPropuesta = computarPropuesta(ninos, AULAS, new Set(['1']))
    // El niño ya tiene una pendiente en 'a-2a3' (override de la directora).
    const filas = construirFilasRollover(ninos, resultado, new Map([['1', 'a-2a3']]))
    expect(filas[0]!.aula_propuesta_id).toBe('a-2a3')
    expect(filas[0]!.accion).toBe('continua')
  })
})
