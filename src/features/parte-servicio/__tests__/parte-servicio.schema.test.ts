import { describe, expect, it } from 'vitest'

import { paseServiciosInputSchema, servicioDiarioEnum } from '../schemas/parte-servicio'

const CENTRO = '11111111-1111-4111-8111-111111111111'
const NINO = '22222222-2222-4222-9222-222222222222'
const OTRO = '33333333-3333-4333-9333-333333333333'

describe('parte_servicio — schema Zod del listado único', () => {
  it('acepta casillas de los tres servicios a la vez', () => {
    const r = paseServiciosInputSchema.safeParse({
      centro_id: CENTRO,
      fecha: '2026-06-28',
      items: [
        { nino_id: NINO, servicio: 'matinera', presente: true },
        { nino_id: NINO, servicio: 'comedor', presente: true },
        { nino_id: OTRO, servicio: 'vespertina', presente: false },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('rechaza servicio desconocido', () => {
    expect(servicioDiarioEnum.safeParse('almuerzo').success).toBe(false)
  })

  it('acepta los tres servicios válidos', () => {
    for (const s of ['comedor', 'matinera', 'vespertina']) {
      expect(servicioDiarioEnum.safeParse(s).success).toBe(true)
    }
  })

  it('rechaza fecha mal formada', () => {
    const r = paseServiciosInputSchema.safeParse({
      centro_id: CENTRO,
      fecha: '28-06-2026',
      items: [{ nino_id: NINO, servicio: 'comedor', presente: true }],
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('parte_servicio.validation.fecha_invalida')
    }
  })

  it('rechaza un guardado sin casillas', () => {
    const r = paseServiciosInputSchema.safeParse({
      centro_id: CENTRO,
      fecha: '2026-06-28',
      items: [],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza la misma casilla dos veces (el upsert no admite la misma fila)', () => {
    const r = paseServiciosInputSchema.safeParse({
      centro_id: CENTRO,
      fecha: '2026-06-28',
      items: [
        { nino_id: NINO, servicio: 'comedor', presente: true },
        { nino_id: NINO, servicio: 'comedor', presente: false },
      ],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza centro_id no uuid', () => {
    const r = paseServiciosInputSchema.safeParse({
      centro_id: 'no-uuid',
      fecha: '2026-06-28',
      items: [{ nino_id: NINO, servicio: 'vespertina', presente: false }],
    })
    expect(r.success).toBe(false)
  })
})
