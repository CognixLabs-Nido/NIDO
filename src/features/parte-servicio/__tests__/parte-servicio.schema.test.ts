import { describe, expect, it } from 'vitest'

import { parteServicioBatchInputSchema, servicioDiarioEnum } from '../schemas/parte-servicio'

const CENTRO = '11111111-1111-4111-8111-111111111111'
const NINO = '22222222-2222-4222-9222-222222222222'

describe('parte_servicio — schema Zod', () => {
  it('acepta un batch válido', () => {
    const r = parteServicioBatchInputSchema.safeParse({
      centro_id: CENTRO,
      fecha: '2026-06-28',
      servicio: 'comedor',
      items: [{ nino_id: NINO, presente: true }],
    })
    expect(r.success).toBe(true)
  })

  it('rechaza servicio desconocido', () => {
    const r = servicioDiarioEnum.safeParse('almuerzo')
    expect(r.success).toBe(false)
  })

  it('acepta los tres servicios válidos', () => {
    for (const s of ['comedor', 'matinera', 'vespertina']) {
      expect(servicioDiarioEnum.safeParse(s).success).toBe(true)
    }
  })

  it('rechaza fecha mal formada', () => {
    const r = parteServicioBatchInputSchema.safeParse({
      centro_id: CENTRO,
      fecha: '28-06-2026',
      servicio: 'comedor',
      items: [{ nino_id: NINO, presente: true }],
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('parte_servicio.validation.fecha_invalida')
    }
  })

  it('rechaza batch sin items', () => {
    const r = parteServicioBatchInputSchema.safeParse({
      centro_id: CENTRO,
      fecha: '2026-06-28',
      servicio: 'matinera',
      items: [],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza centro_id no uuid', () => {
    const r = parteServicioBatchInputSchema.safeParse({
      centro_id: 'no-uuid',
      fecha: '2026-06-28',
      servicio: 'vespertina',
      items: [{ nino_id: NINO, presente: false }],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza presente no booleano', () => {
    const r = parteServicioBatchInputSchema.safeParse({
      centro_id: CENTRO,
      fecha: '2026-06-28',
      servicio: 'comedor',
      items: [{ nino_id: NINO, presente: 'si' }],
    })
    expect(r.success).toBe(false)
  })
})
