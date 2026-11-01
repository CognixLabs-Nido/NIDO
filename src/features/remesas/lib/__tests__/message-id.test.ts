import { describe, expect, it, vi } from 'vitest'

import { MAX_IDENTIFICADOR_SEPA } from '../generar-pain008'
import { messageIdRemesa, versionRemesa } from '../message-id'

const ID = '7816a306-50a0-4364-81b9-8e93d41f3b31'

describe('messageIdRemesa', () => {
  it('sale de la marca, en UTC, con la forma de PostgREST', () => {
    expect(messageIdRemesa(ID, '2026-10-31T15:49:21.123456+00:00')).toBe(
      'NIDO-7816a306-20261031154921'
    )
    // La misma marca en otro huso es el mismo instante y el mismo MsgId.
    expect(messageIdRemesa(ID, '2026-10-31T16:49:21.123+01:00')).toBe(
      'NIDO-7816a306-20261031154921'
    )
  })

  it('la misma marca da siempre el mismo MsgId; otra marca, otro', () => {
    const marca = '2026-10-31T10:00:00.000Z'
    expect(messageIdRemesa(ID, marca)).toBe(messageIdRemesa(ID, marca))
    expect(messageIdRemesa(ID, '2026-10-31T10:00:01.000Z')).not.toBe(messageIdRemesa(ID, marca))
  })

  it('cabe en Max35: 28 caracteres', () => {
    const msgId = messageIdRemesa(ID, '2026-10-31T10:00:00Z')
    expect(msgId).toHaveLength(28)
    expect(msgId.length).toBeLessThanOrEqual(MAX_IDENTIFICADOR_SEPA)
  })

  it('una marca que no es una fecha no da un MsgId', () => {
    expect(() => messageIdRemesa(ID, 'no-es-fecha')).toThrow(/marca/)
  })
})

describe('versionRemesa', () => {
  it('todo sale de la marca: MsgId, CreDtTm en UTC y el día por defecto', () => {
    expect(versionRemesa(ID, '2026-10-31T15:49:21.123456+00:00')).toEqual({
      messageId: messageIdRemesa(ID, '2026-10-31T15:49:21.123456+00:00'),
      creationDateTime: '2026-10-31T15:49:21',
      fechaPorDefecto: '2026-10-31',
    })
  })

  it('el día por defecto es el de Madrid: de noche en UTC ya es el día siguiente', () => {
    // Invierno (+1): 23:30 UTC son las 00:30 del 1 de noviembre.
    expect(versionRemesa(ID, '2026-10-31T23:30:00Z').fechaPorDefecto).toBe('2026-11-01')
    // Verano (+2): 22:30 UTC son las 00:30 del día siguiente; 21:59, todavía el mismo.
    expect(versionRemesa(ID, '2026-07-04T22:30:00Z').fechaPorDefecto).toBe('2026-07-05')
    expect(versionRemesa(ID, '2026-07-04T21:59:00Z').fechaPorDefecto).toBe('2026-07-04')
  })

  it('no mira el reloj: la misma marca, otro día, da lo mismo', () => {
    const marca = '2026-10-31T10:00:00.000Z'
    const hoy = versionRemesa(ID, marca)
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-11-04T18:00:00Z'))
      expect(versionRemesa(ID, marca)).toEqual(hoy)
    } finally {
      vi.useRealTimers()
    }
  })
})
