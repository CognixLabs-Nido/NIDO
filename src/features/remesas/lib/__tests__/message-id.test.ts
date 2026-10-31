import { describe, expect, it } from 'vitest'

import { MAX_IDENTIFICADOR_SEPA } from '../generar-pain008'
import { messageIdRemesa } from '../message-id'

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
