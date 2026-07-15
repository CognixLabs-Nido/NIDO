import { describe, expect, it } from 'vitest'

import {
  prepararRemesa,
  type AcreedorData,
  type MandatoRemesaRow,
  type RemesaMeta,
} from '../preparar-remesa'

const acreedorOk: AcreedorData = {
  identificador_acreedor: 'ES00ZZZ00000000000',
  bic_acreedor: 'CAIXESBBXXX',
  iban: 'ES9121000418450200051332',
}

const meta: RemesaMeta = {
  messageId: 'NIDO-TEST-1',
  creationDateTime: '2026-07-01T12:00:00',
  collectionDate: '2026-07-05',
  creditorName: 'Escola Demo',
}

function row(over: Partial<MandatoRemesaRow>): MandatoRemesaRow {
  return {
    recibo_id: '11111111-1111-4111-8111-111111111111',
    familia_id: '22222222-2222-4222-9222-222222222222',
    familia_etiqueta: 'Familia Pérez',
    total_centimos: 12000,
    identificador_mandato: 'NIDO-DEMO-1',
    iban: 'ES7620770024003102575766',
    titular: 'Ana Pérez',
    fecha_mandato: '2026-06-01',
    ...over,
  }
}

describe('prepararRemesa', () => {
  it('genera el XML cuando todo es válido', () => {
    const r = prepararRemesa([row({})], acreedorOk, meta)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.numOperaciones).toBe(1)
      expect(r.totalCentimos).toBe(12000)
      expect(r.excluidosSinImporte).toEqual([])
      expect(r.xml).toContain('pain.008.001.02')
    }
  })

  it('falla si el acreedor no tiene CID', () => {
    const r = prepararRemesa([row({})], { ...acreedorOk, identificador_acreedor: null }, meta)
    expect(r).toEqual({ ok: false, motivo: 'acreedor_incompleto' })
  })

  it('falla si el acreedor no tiene IBAN', () => {
    const r = prepararRemesa([row({})], { ...acreedorOk, iban: null }, meta)
    expect(r).toEqual({ ok: false, motivo: 'acreedor_incompleto' })
  })

  it('rechaza la remesa entera si algún recibo no tiene mandato activo', () => {
    const r = prepararRemesa(
      [
        row({}),
        row({
          recibo_id: '33333333-3333-4333-8333-333333333333',
          familia_etiqueta: 'Familia Sin Mandato',
          iban: null,
        }),
      ],
      acreedorOk,
      meta
    )
    expect(r.ok).toBe(false)
    if (!r.ok && r.motivo === 'sin_mandato') {
      expect(r.familiasSinMandato).toEqual(['Familia Sin Mandato'])
    } else {
      throw new Error('esperado motivo sin_mandato')
    }
  })

  it('trata mandato sin fecha como ausente (sin_mandato)', () => {
    const r = prepararRemesa([row({ fecha_mandato: null })], acreedorOk, meta)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBe('sin_mandato')
  })

  it('excluye importes ≤ 0 y los reporta, sin bloquear el resto', () => {
    const r = prepararRemesa(
      [row({}), row({ recibo_id: '44444444-4444-4444-8444-444444444444', total_centimos: -500 })],
      acreedorOk,
      meta
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.numOperaciones).toBe(1)
      expect(r.excluidosSinImporte).toEqual(['44444444-4444-4444-8444-444444444444'])
    }
  })

  it('devuelve remesa_vacia si tras excluir no queda ningún deudor', () => {
    const r = prepararRemesa([row({ total_centimos: 0 })], acreedorOk, meta)
    expect(r).toEqual({ ok: false, motivo: 'remesa_vacia' })
  })
})
