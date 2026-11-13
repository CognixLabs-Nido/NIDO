import { describe, expect, it } from 'vitest'

import { BUCKETS_FUERA_DEL_OLVIDO, compararCatalogoBuckets } from '../catalogo-buckets'

describe('compararCatalogoBuckets', () => {
  const delOlvido = ['dni-tutores', 'sip-ninos']
  const fuera = ['mandato-sepa']

  it('premisa: con los tres sitios de acuerdo no hay nada que decir', () => {
    expect(
      compararCatalogoBuckets(['dni-tutores', 'sip-ninos', 'mandato-sepa'], delOlvido, fuera)
    ).toEqual({ sinDueno: [], inexistentes: [], enLosDos: [] })
  })

  it('control positivo: un bucket de mentira que nadie nombra sale como sin dueño', () => {
    const r = compararCatalogoBuckets(
      ['dni-tutores', 'sip-ninos', 'mandato-sepa', 'bucket-de-mentira'],
      delOlvido,
      fuera
    )
    expect(r.sinDueno).toEqual(['bucket-de-mentira'])
  })

  it('un bucket del catálogo que ya no existe, también', () => {
    expect(compararCatalogoBuckets(['dni-tutores'], delOlvido, fuera).inexistentes).toEqual([
      'mandato-sepa',
      'sip-ninos',
    ])
  })

  it('o lo borra el olvido o está fuera, no las dos cosas', () => {
    expect(
      compararCatalogoBuckets(['dni-tutores', 'sip-ninos'], delOlvido, ['sip-ninos']).enLosDos
    ).toEqual(['sip-ninos'])
  })

  it('cada bucket de fuera dice quién lo borra o por qué no es de nadie', () => {
    for (const [bucket, motivo] of Object.entries(BUCKETS_FUERA_DEL_OLVIDO)) {
      expect(motivo.length, bucket).toBeGreaterThan(40)
    }
  })
})
