import { describe, expect, it } from 'vitest'

import {
  abrirCampanaSchema,
  cambiarEstadoCampanaSchema,
  editarFechaCampanaSchema,
} from '@/features/informes/schemas/campanas-informe'

/**
 * F9-5-1 — Validación Zod de las campañas de informe. El curso lo fija el server
 * (no entra en el schema, Q7); aquí se valida período + fecha límite (formato y
 * fecha de calendario real) y el cambio de estado.
 */
describe('abrirCampanaSchema', () => {
  it('acepta período válido + fecha AAAA-MM-DD real', () => {
    const r = abrirCampanaSchema.safeParse({ periodo: 'trimestre_1', fecha_limite: '2026-12-20' })
    expect(r.success).toBe(true)
  })

  it('rechaza período fuera del enum', () => {
    const r = abrirCampanaSchema.safeParse({ periodo: 'trimestre_9', fecha_limite: '2026-12-20' })
    expect(r.success).toBe(false)
  })

  it('rechaza fecha con formato inválido', () => {
    const r = abrirCampanaSchema.safeParse({ periodo: 'fin_curso', fecha_limite: '20/12/2026' })
    expect(r.success).toBe(false)
    if (!r.success)
      expect(r.error.issues[0]?.message).toBe('informes.campana.validation.fecha_invalida')
  })

  it('rechaza fecha de calendario imposible (2026-02-31)', () => {
    const r = abrirCampanaSchema.safeParse({ periodo: 'trimestre_2', fecha_limite: '2026-02-31' })
    expect(r.success).toBe(false)
  })

  it('acepta un 29 de febrero bisiesto y rechaza uno no bisiesto', () => {
    expect(
      abrirCampanaSchema.safeParse({ periodo: 'trimestre_2', fecha_limite: '2028-02-29' }).success
    ).toBe(true)
    expect(
      abrirCampanaSchema.safeParse({ periodo: 'trimestre_2', fecha_limite: '2027-02-29' }).success
    ).toBe(false)
  })
})

describe('editarFechaCampanaSchema', () => {
  it('acepta uuid + fecha válida', () => {
    const r = editarFechaCampanaSchema.safeParse({
      campana_id: '11111111-1111-4111-8111-111111111111',
      fecha_limite: '2027-01-15',
    })
    expect(r.success).toBe(true)
  })

  it('rechaza id no-uuid', () => {
    const r = editarFechaCampanaSchema.safeParse({ campana_id: 'abc', fecha_limite: '2027-01-15' })
    expect(r.success).toBe(false)
  })
})

describe('cambiarEstadoCampanaSchema', () => {
  it('acepta abierta/cerrada', () => {
    for (const estado of ['abierta', 'cerrada'] as const) {
      const r = cambiarEstadoCampanaSchema.safeParse({
        campana_id: '11111111-1111-4111-8111-111111111111',
        estado,
      })
      expect(r.success).toBe(true)
    }
  })

  it('rechaza un estado fuera del enum', () => {
    const r = cambiarEstadoCampanaSchema.safeParse({
      campana_id: '11111111-1111-4111-8111-111111111111',
      estado: 'archivada',
    })
    expect(r.success).toBe(false)
  })
})
