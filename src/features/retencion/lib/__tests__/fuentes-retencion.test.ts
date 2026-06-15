import { describe, expect, it } from 'vitest'

import {
  cutoffFecha,
  ninosVencidosPorBaja,
  pathsDniRecogida,
  recogidaPuntualVencida,
} from '../fuentes-retencion'

describe('cutoffFecha', () => {
  it('resta días y devuelve YYYY-MM-DD', () => {
    expect(cutoffFecha('2026-06-15T03:00:00.000Z', { dias: 7 })).toBe('2026-06-08')
  })
  it('resta meses', () => {
    expect(cutoffFecha('2026-06-15T03:00:00.000Z', { meses: 12 })).toBe('2025-06-15')
  })
})

describe('recogidaPuntualVencida', () => {
  const cutoff = '2026-06-08' // hoy − 7d
  it('vencida si vigencia_hasta es anterior al corte', () => {
    expect(recogidaPuntualVencida('2026-06-01', cutoff)).toBe(true)
  })
  it('NO vencida si está dentro de la ventana', () => {
    expect(recogidaPuntualVencida('2026-06-10', cutoff)).toBe(false)
  })
  it('habitual (vigencia_hasta NULL) no es "puntual vencida"', () => {
    expect(recogidaPuntualVencida(null, cutoff)).toBe(false)
  })
})

describe('ninosVencidosPorBaja', () => {
  const cutoff = '2025-06-15' // hoy − 12m

  it('incluye al niño sin matrícula activa y con baja anterior al corte', () => {
    const out = ninosVencidosPorBaja([{ nino_id: 'n1', fecha_baja: '2024-01-01' }], cutoff)
    expect(out.has('n1')).toBe(true)
  })

  it('excluye al niño con matrícula activa (fecha_baja NULL) aunque tenga una baja vieja', () => {
    const out = ninosVencidosPorBaja(
      [
        { nino_id: 'n2', fecha_baja: '2023-01-01' },
        { nino_id: 'n2', fecha_baja: null },
      ],
      cutoff
    )
    expect(out.has('n2')).toBe(false)
  })

  it('excluye al niño cuya baja es reciente (dentro del plazo)', () => {
    const out = ninosVencidosPorBaja([{ nino_id: 'n3', fecha_baja: '2026-01-01' }], cutoff)
    expect(out.has('n3')).toBe(false)
  })

  it('usa la baja MÁS RECIENTE para decidir', () => {
    const out = ninosVencidosPorBaja(
      [
        { nino_id: 'n4', fecha_baja: '2024-01-01' },
        { nino_id: 'n4', fecha_baja: '2026-02-01' }, // reciente → no vencido
      ],
      cutoff
    )
    expect(out.has('n4')).toBe(false)
  })
})

describe('pathsDniRecogida', () => {
  it('extrae solo los adjuntos del bucket recogida-adjuntos', () => {
    const datos = {
      personas: [{ nombre: 'X', dni: '123' }],
      adjuntos: [
        { bucket: 'recogida-adjuntos', path: 'c/n/a.jpg', hash: 'h1' },
        { bucket: 'otro-bucket', path: 'c/n/b.jpg', hash: 'h2' },
      ],
    }
    expect(pathsDniRecogida(datos)).toEqual(['c/n/a.jpg'])
  })

  it('devuelve [] sin adjuntos o con datos mal formados', () => {
    expect(pathsDniRecogida({ personas: [] })).toEqual([])
    expect(pathsDniRecogida(null)).toEqual([])
    expect(pathsDniRecogida('x')).toEqual([])
  })
})
