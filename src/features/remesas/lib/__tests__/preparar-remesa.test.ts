import { describe, expect, it } from 'vitest'

import {
  endToEndIdDeRecibo,
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
  messageId: 'NIDO-0D06FFD1-20261031120000',
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
    // Forma de un mandato firmado desde el PR-0b (31 caracteres).
    identificador_mandato: 'NIDO-33C79B50-87319A17-MH3K2Q8L',
    iban: 'ES7620770024003102575766',
    titular: 'Ana Pérez',
    fecha_mandato: '2026-06-01',
    ...over,
  }
}

// Forma de los mandatos de producción firmados antes del PR-0b (medida el 2026-10-31).
const MANDATO_36_PRODUCCION = 'NIDO-33C79B50-87319A17-1784546999227'

/** Un concepto por cada recibo que se le pase (lo que hace `conceptosDeRemesa` en la ruta). */
function conceptosDe(rows: MandatoRemesaRow[]): Map<string, string> {
  return new Map(
    rows.map((r) => [r.recibo_id, `CEI Ejemplo · ${r.familia_etiqueta} · Octubre 2026`])
  )
}

function preparar(rows: MandatoRemesaRow[], acreedor = acreedorOk) {
  return prepararRemesa(rows, acreedor, meta, conceptosDe(rows))
}

describe('prepararRemesa', () => {
  it('genera el XML cuando todo es válido', () => {
    const r = preparar([row({})])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.numOperaciones).toBe(1)
      expect(r.totalCentimos).toBe(12000)
      expect(r.excluidosSinImporte).toEqual([])
      expect(r.xml).toContain('pain.008.001.02')
    }
  })

  it('falla si el acreedor no tiene CID', () => {
    const r = preparar([row({})], { ...acreedorOk, identificador_acreedor: null })
    expect(r).toEqual({ ok: false, motivo: 'acreedor_incompleto' })
  })

  it('falla si el acreedor no tiene IBAN', () => {
    const r = preparar([row({})], { ...acreedorOk, iban: null })
    expect(r).toEqual({ ok: false, motivo: 'acreedor_incompleto' })
  })

  it('rechaza la remesa entera si algún recibo no tiene mandato activo', () => {
    const r = preparar([
      row({}),
      row({
        recibo_id: '33333333-3333-4333-8333-333333333333',
        familia_etiqueta: 'Familia Sin Mandato',
        iban: null,
      }),
    ])
    expect(r.ok).toBe(false)
    if (!r.ok && r.motivo === 'sin_mandato') {
      expect(r.familiasSinMandato).toEqual(['Familia Sin Mandato'])
    } else {
      throw new Error('esperado motivo sin_mandato')
    }
  })

  it('trata mandato sin fecha como ausente (sin_mandato)', () => {
    const r = preparar([row({ fecha_mandato: null })])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBe('sin_mandato')
  })

  it('excluye importes ≤ 0 y los reporta, sin bloquear el resto', () => {
    const r = preparar([
      row({}),
      row({ recibo_id: '44444444-4444-4444-8444-444444444444', total_centimos: -500 }),
    ])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.numOperaciones).toBe(1)
      expect(r.excluidosSinImporte).toEqual(['44444444-4444-4444-8444-444444444444'])
    }
  })

  it('devuelve remesa_vacia si tras excluir no queda ningún deudor', () => {
    const r = preparar([row({ total_centimos: 0 })])
    expect(r).toEqual({ ok: false, motivo: 'remesa_vacia' })
  })

  it('el EndToEndId es el id del recibo sin guiones (32) y el concepto llega al extracto', () => {
    const r = preparar([row({ recibo_id: '0d06ffd1-d24e-4d6e-b1db-341d6c94bb26' })])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.xml).toContain('<EndToEndId>0D06FFD1D24E4D6EB1DB341D6C94BB26</EndToEndId>')
      expect(r.xml).toContain('<Ustrd>CEI Ejemplo - Familia Perez - Octubre 2026</Ustrd>')
    }
    expect(endToEndIdDeRecibo('0d06ffd1-d24e-4d6e-b1db-341d6c94bb26')).toHaveLength(32)
  })

  it('un mandato de 36 (los de producción de antes del PR-0b) no genera: dice qué familias', () => {
    const rows = [
      row({}),
      row({
        recibo_id: '55555555-5555-4555-8555-555555555555',
        familia_etiqueta: 'Familia Mandato Antiguo',
        identificador_mandato: MANDATO_36_PRODUCCION,
      }),
    ]
    expect(preparar(rows)).toEqual({
      ok: false,
      motivo: 'identificador_largo',
      familiasIdentificadorLargo: ['Familia Mandato Antiguo'],
    })
  })

  it('un recibo cobrable sin concepto lanza: el fichero no sale con el extracto vacío', () => {
    expect(() => prepararRemesa([row({})], acreedorOk, meta, new Map())).toThrow(/sin concepto/)
  })
})
