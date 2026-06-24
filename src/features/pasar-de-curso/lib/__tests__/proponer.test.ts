import { describe, expect, it } from 'vitest'

import { computarPropuesta, type AulaDestinoRollover, type NinoActivoRollover } from '../proponer'

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

function nino(id: string, anio: number | null): NinoActivoRollover {
  return {
    nino_id: id,
    nombre: `Niño ${id}`,
    apellidos: 'Test',
    fecha_nacimiento: anio === null ? null : `${anio}-03-15`,
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

  it('≥2 salas candidatas → requiere elección con las candidatas', () => {
    const solapan = [
      { ...AULA_1A2, tramo_edad: [2024] },
      { aula_id: 'a-mixta', nombre: 'Mixta', tramo_edad: [2024, 2023], capacidad: 6 },
    ]
    const r = computarPropuesta([nino('1', 2024)], solapan, new Set())
    expect(r.propuestas).toHaveLength(0)
    expect(r.requiereEleccion).toHaveLength(1)
    expect(r.requiereEleccion[0]).toMatchObject({
      nino_id: '1',
      motivo: 'multiples_candidatas',
    })
    expect(r.requiereEleccion[0]!.candidatas.sort()).toEqual(['a-1a2', 'a-mixta'])
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
})
