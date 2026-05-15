import { describe, expect, it } from 'vitest'

import {
  agendaCabeceraInputSchema,
  biberonInputSchema,
  comidaInputSchema,
  deposicionInputSchema,
  esAnulado,
  PREFIX_ANULADO,
  suenoInputSchema,
} from '../schemas/agenda-diaria'

const ninoId = '4f1b1d0a-8e7f-4c8e-9b6d-2a3e6f5c0a91'

describe('agenda-diaria — schemas Zod', () => {
  it('cabecera acepta nulls en estado/humor/observaciones', () => {
    const r = agendaCabeceraInputSchema.safeParse({
      nino_id: ninoId,
      fecha: '2026-05-15',
      estado_general: null,
      humor: null,
      observaciones_generales: null,
    })
    expect(r.success).toBe(true)
  })

  it('cabecera rechaza fecha con formato inválido', () => {
    const r = agendaCabeceraInputSchema.safeParse({
      nino_id: ninoId,
      fecha: '15/05/2026',
      estado_general: 'bien',
      humor: 'feliz',
      observaciones_generales: null,
    })
    expect(r.success).toBe(false)
  })

  it('comida válida con momento, cantidad y descripcion', () => {
    const r = comidaInputSchema.safeParse({
      momento: 'comida',
      hora: '13:00',
      cantidad: 'mayoria',
      descripcion: 'pasta con tomate',
      observaciones: null,
    })
    expect(r.success).toBe(true)
  })

  it('biberón rechaza cantidad_ml > 500', () => {
    const r = biberonInputSchema.safeParse({
      hora: '10:30',
      cantidad_ml: 600,
      tipo: 'formula',
      tomado_completo: true,
      observaciones: null,
    })
    expect(r.success).toBe(false)
  })

  it('biberón rechaza hora con formato no HH:MM', () => {
    const r = biberonInputSchema.safeParse({
      hora: '10h30',
      cantidad_ml: 150,
      tipo: 'agua',
      tomado_completo: true,
      observaciones: null,
    })
    expect(r.success).toBe(false)
  })

  it('sueño rechaza hora_fin <= hora_inicio', () => {
    const r = suenoInputSchema.safeParse({
      hora_inicio: '14:00',
      hora_fin: '13:30',
      calidad: 'tranquilo',
      observaciones: null,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('agenda.validation.sueno_fin_anterior')
    }
  })

  it('sueño acepta hora_fin null (siesta en curso)', () => {
    const r = suenoInputSchema.safeParse({
      hora_inicio: '14:00',
      hora_fin: null,
      calidad: null,
      observaciones: null,
    })
    expect(r.success).toBe(true)
  })

  it('deposición pipi rechaza consistencia', () => {
    const r = deposicionInputSchema.safeParse({
      hora: null,
      tipo: 'pipi',
      consistencia: 'blanda',
      cantidad: 'normal',
      observaciones: null,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('agenda.validation.consistencia_solo_caca')
    }
  })

  it('deposición caca con consistencia válida', () => {
    const r = deposicionInputSchema.safeParse({
      hora: '11:00',
      tipo: 'caca',
      consistencia: 'normal',
      cantidad: 'normal',
      observaciones: null,
    })
    expect(r.success).toBe(true)
  })
})

describe('esAnulado helper', () => {
  it('detecta prefijo [anulado]', () => {
    expect(esAnulado(`${PREFIX_ANULADO}era un error`)).toBe(true)
  })
  it('falso si observaciones es null o vacío', () => {
    expect(esAnulado(null)).toBe(false)
    expect(esAnulado('')).toBe(false)
  })
  it('falso si no empieza por el prefijo exacto', () => {
    expect(esAnulado('[Anulado] err')).toBe(false)
    expect(esAnulado('comentario [anulado] ')).toBe(false)
  })
})
