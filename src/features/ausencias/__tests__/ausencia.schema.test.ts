import { describe, expect, it } from 'vitest'

import { ausenciaInputSchema, esCancelada, PREFIX_CANCELADA } from '../schemas/ausencia'

const ninoId = '4f1b1d0a-8e7f-4c8e-9b6d-2a3e6f5c0a91'

describe('ausencia — schema Zod', () => {
  it('rango fechas válido pasa', () => {
    const r = ausenciaInputSchema.safeParse({
      nino_id: ninoId,
      fecha_inicio: '2026-05-15',
      fecha_fin: '2026-05-17',
      motivo: 'vacaciones',
      descripcion: null,
    })
    expect(r.success).toBe(true)
  })

  it('un solo día (fecha_fin = fecha_inicio) es válido', () => {
    const r = ausenciaInputSchema.safeParse({
      nino_id: ninoId,
      fecha_inicio: '2026-05-15',
      fecha_fin: '2026-05-15',
      motivo: 'cita_medica',
      descripcion: null,
    })
    expect(r.success).toBe(true)
  })

  it('fecha_fin anterior a fecha_inicio falla', () => {
    const r = ausenciaInputSchema.safeParse({
      nino_id: ninoId,
      fecha_inicio: '2026-05-15',
      fecha_fin: '2026-05-14',
      motivo: 'enfermedad',
      descripcion: null,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('ausencia.validation.fecha_fin_anterior')
    }
  })

  it('motivo inválido falla', () => {
    const r = ausenciaInputSchema.safeParse({
      nino_id: ninoId,
      fecha_inicio: '2026-05-15',
      fecha_fin: '2026-05-15',
      motivo: 'algo_no_existente',
      descripcion: null,
    })
    expect(r.success).toBe(false)
  })

  it('descripcion > 500 caracteres falla', () => {
    const r = ausenciaInputSchema.safeParse({
      nino_id: ninoId,
      fecha_inicio: '2026-05-15',
      fecha_fin: '2026-05-15',
      motivo: 'enfermedad',
      descripcion: 'x'.repeat(501),
    })
    expect(r.success).toBe(false)
  })
})

describe('esCancelada helper', () => {
  it('detecta prefijo [cancelada]', () => {
    expect(esCancelada(`${PREFIX_CANCELADA}era un error`)).toBe(true)
  })
  it('falso si null o vacío', () => {
    expect(esCancelada(null)).toBe(false)
    expect(esCancelada('')).toBe(false)
  })
  it('falso si el prefijo no está al inicio exacto', () => {
    expect(esCancelada('comentario [cancelada]')).toBe(false)
    expect(esCancelada('[Cancelada] mal escrito')).toBe(false)
  })
})
