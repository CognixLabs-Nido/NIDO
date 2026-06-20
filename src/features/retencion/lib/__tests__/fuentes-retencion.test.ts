import { describe, expect, it } from 'vitest'

import {
  cutoffFecha,
  cutoffTimestamp,
  esEsqueletoHuerfano,
  invitacionAbiertaValida,
  invitacionVencida,
  ninosVencidosPorBaja,
  pathsDniRecogida,
  recogidaPuntualVencida,
  type InvitacionMin,
  type NinoEsqueletoInput,
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

// ---------------------------------------------------------------------------
// A6 — esqueleto huérfano (predicados puros)
// ---------------------------------------------------------------------------

describe('cutoffTimestamp', () => {
  it('resta días y devuelve ISO timestamptz', () => {
    expect(cutoffTimestamp('2026-06-20T12:00:00.000Z', 30)).toBe('2026-05-21T12:00:00.000Z')
  })
})

describe('invitacionVencida / invitacionAbiertaValida', () => {
  const cutoff = '2026-05-21T12:00:00.000Z' // hoy − 30d
  const abierta = (expires: string): InvitacionMin => ({
    accepted_at: null,
    rejected_at: null,
    expires_at: expires,
  })

  it('vencida: abierta y expires_at < cutoff', () => {
    expect(invitacionVencida(abierta('2026-05-01T00:00:00.000Z'), cutoff)).toBe(true)
    expect(invitacionAbiertaValida(abierta('2026-05-01T00:00:00.000Z'), cutoff)).toBe(false)
  })

  it('abierta-válida: dentro de gracia (expires_at >= cutoff)', () => {
    expect(invitacionAbiertaValida(abierta('2026-06-24T00:00:00.000Z'), cutoff)).toBe(true)
    expect(invitacionVencida(abierta('2026-06-24T00:00:00.000Z'), cutoff)).toBe(false)
  })

  it('aceptada o rechazada nunca cuenta como abierta', () => {
    const aceptada: InvitacionMin = {
      accepted_at: '2026-05-02T00:00:00.000Z',
      rejected_at: null,
      expires_at: '2026-05-01T00:00:00.000Z',
    }
    const rechazada: InvitacionMin = {
      accepted_at: null,
      rejected_at: '2026-05-02T00:00:00.000Z',
      expires_at: '2026-05-01T00:00:00.000Z',
    }
    expect(invitacionVencida(aceptada, cutoff)).toBe(false)
    expect(invitacionVencida(rechazada, cutoff)).toBe(false)
    expect(invitacionAbiertaValida(aceptada, cutoff)).toBe(false)
  })
})

describe('esEsqueletoHuerfano', () => {
  const cutoff = '2026-05-21T12:00:00.000Z' // hoy − 30d
  const pendienteViva = { estado: 'pendiente', fecha_baja: null, deleted_at: null }
  const invVencida: InvitacionMin = {
    accepted_at: null,
    rejected_at: null,
    expires_at: '2026-05-01T00:00:00.000Z',
  }
  const invValida: InvitacionMin = {
    accepted_at: null,
    rejected_at: null,
    expires_at: '2026-06-24T00:00:00.000Z',
  }

  const base: NinoEsqueletoInput = {
    matriculas: [pendienteViva],
    vinculosActivos: 0,
    invitaciones: [invVencida],
  }

  it('huérfano: pendiente + sin vínculos + invitación vencida + ninguna abierta-válida', () => {
    expect(esEsqueletoHuerfano(base, cutoff)).toBe(true)
  })

  it('NO huérfano: tiene un vínculo activo (alguien aceptó)', () => {
    expect(esEsqueletoHuerfano({ ...base, vinculosActivos: 1 }, cutoff)).toBe(false)
  })

  it('NO huérfano: hay una invitación abierta-válida (alguien la reactivó)', () => {
    expect(esEsqueletoHuerfano({ ...base, invitaciones: [invVencida, invValida] }, cutoff)).toBe(
      false
    )
  })

  it('NO huérfano: ninguna invitación vencida (solo válida)', () => {
    expect(esEsqueletoHuerfano({ ...base, invitaciones: [invValida] }, cutoff)).toBe(false)
  })

  it('NO huérfano: sin invitación alguna (niño creado a mano, nunca invitado)', () => {
    expect(esEsqueletoHuerfano({ ...base, invitaciones: [] }, cutoff)).toBe(false)
  })

  it('NO huérfano: matrícula activa, no pendiente', () => {
    expect(
      esEsqueletoHuerfano(
        { ...base, matriculas: [{ estado: 'activa', fecha_baja: null, deleted_at: null }] },
        cutoff
      )
    ).toBe(false)
  })

  it('NO huérfano: matrícula pendiente pero soft-deleted / con baja', () => {
    expect(
      esEsqueletoHuerfano(
        {
          ...base,
          matriculas: [{ estado: 'pendiente', fecha_baja: null, deleted_at: '2026-06-01' }],
        },
        cutoff
      )
    ).toBe(false)
    expect(
      esEsqueletoHuerfano(
        {
          ...base,
          matriculas: [{ estado: 'pendiente', fecha_baja: '2026-06-01', deleted_at: null }],
        },
        cutoff
      )
    ).toBe(false)
  })
})
