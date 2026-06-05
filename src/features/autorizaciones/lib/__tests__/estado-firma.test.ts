import { describe, expect, it } from 'vitest'

import {
  calcularEstadoNino,
  firmasVigentesPorFirmante,
  type FirmaEfectiva,
  type FirmanteVinculo,
} from '../estado-firma'

const principal = (id: string, nombre = `Tutor ${id}`): FirmanteVinculo => ({
  firmante_id: id,
  firmante_nombre: nombre,
  rol_firmante: 'tutor_legal_principal',
  es_principal: true,
})

const secundario = (id: string): FirmanteVinculo => ({
  firmante_id: id,
  firmante_nombre: `Sec ${id}`,
  rol_firmante: 'tutor_legal_secundario',
  es_principal: false,
})

const firma = (id: string, decision: FirmaEfectiva['decision'], ts: string): FirmaEfectiva => ({
  firmante_id: id,
  decision,
  firmado_at: ts,
})

describe('firmasVigentesPorFirmante', () => {
  it('se queda con la firma más reciente por firmante (append-only)', () => {
    const vig = firmasVigentesPorFirmante([
      firma('a', 'firmado', '2026-06-01T10:00:00Z'),
      firma('a', 'revocado', '2026-06-02T10:00:00Z'),
      firma('b', 'firmado', '2026-06-01T09:00:00Z'),
    ])
    expect(vig.get('a')?.decision).toBe('revocado')
    expect(vig.get('b')?.decision).toBe('firmado')
  })

  it('re-firmar tras revocar deja la firma como vigente', () => {
    const vig = firmasVigentesPorFirmante([
      firma('a', 'firmado', '2026-06-01T10:00:00Z'),
      firma('a', 'revocado', '2026-06-02T10:00:00Z'),
      firma('a', 'firmado', '2026-06-03T10:00:00Z'),
    ])
    expect(vig.get('a')?.decision).toBe('firmado')
  })
})

describe('calcularEstadoNino — uno_principal', () => {
  it('pendiente sin firmas', () => {
    const { estado } = calcularEstadoNino(
      'uno_principal',
      [principal('a'), principal('b')],
      new Map()
    )
    expect(estado).toBe('pendiente')
  })

  it('firmado si un principal firma (basta uno)', () => {
    const vig = firmasVigentesPorFirmante([firma('a', 'firmado', '2026-06-01T10:00:00Z')])
    const { estado } = calcularEstadoNino('uno_principal', [principal('a'), principal('b')], vig)
    expect(estado).toBe('firmado')
  })

  it('rechazado si el único pronunciamiento es un rechazo', () => {
    const vig = firmasVigentesPorFirmante([firma('a', 'rechazado', '2026-06-01T10:00:00Z')])
    const { estado } = calcularEstadoNino('uno_principal', [principal('a')], vig)
    expect(estado).toBe('rechazado')
  })

  it('firmado prevalece sobre el rechazo de otro principal', () => {
    const vig = firmasVigentesPorFirmante([
      firma('a', 'rechazado', '2026-06-01T10:00:00Z'),
      firma('b', 'firmado', '2026-06-02T10:00:00Z'),
    ])
    const { estado } = calcularEstadoNino('uno_principal', [principal('a'), principal('b')], vig)
    expect(estado).toBe('firmado')
  })
})

describe('calcularEstadoNino — todos_los_principales', () => {
  it('parcial si solo uno de dos principales ha firmado', () => {
    const vig = firmasVigentesPorFirmante([firma('a', 'firmado', '2026-06-01T10:00:00Z')])
    const { estado } = calcularEstadoNino(
      'todos_los_principales',
      [principal('a'), principal('b')],
      vig
    )
    expect(estado).toBe('parcial')
  })

  it('firmado solo cuando todos los principales han firmado', () => {
    const vig = firmasVigentesPorFirmante([
      firma('a', 'firmado', '2026-06-01T10:00:00Z'),
      firma('b', 'firmado', '2026-06-02T10:00:00Z'),
    ])
    const { estado } = calcularEstadoNino(
      'todos_los_principales',
      [principal('a'), principal('b')],
      vig
    )
    expect(estado).toBe('firmado')
  })

  it('un rechazo de cualquiera marca el conjunto como rechazado', () => {
    const vig = firmasVigentesPorFirmante([
      firma('a', 'firmado', '2026-06-01T10:00:00Z'),
      firma('b', 'rechazado', '2026-06-02T10:00:00Z'),
    ])
    const { estado } = calcularEstadoNino(
      'todos_los_principales',
      [principal('a'), principal('b')],
      vig
    )
    expect(estado).toBe('rechazado')
  })

  it('ignora a los secundarios (no son requeridos)', () => {
    const vig = firmasVigentesPorFirmante([firma('a', 'firmado', '2026-06-01T10:00:00Z')])
    const { estado, firmantes } = calcularEstadoNino(
      'todos_los_principales',
      [principal('a'), secundario('s')],
      vig
    )
    expect(estado).toBe('firmado')
    expect(firmantes).toHaveLength(1)
    expect(firmantes[0]!.firmante_id).toBe('a')
  })
})

describe('calcularEstadoNino — bordes', () => {
  it('pendiente y firmantes vacíos si el niño no tiene vínculos', () => {
    const { estado, firmantes } = calcularEstadoNino('uno_principal', [], new Map())
    expect(estado).toBe('pendiente')
    expect(firmantes).toHaveLength(0)
  })

  it('sin principales cae a todos los vínculos (cualquiera) para no quedar sin firmantes', () => {
    const vig = firmasVigentesPorFirmante([firma('s', 'firmado', '2026-06-01T10:00:00Z')])
    const { estado, firmantes } = calcularEstadoNino('uno_principal', [secundario('s')], vig)
    expect(firmantes).toHaveLength(1)
    expect(estado).toBe('firmado')
  })
})
