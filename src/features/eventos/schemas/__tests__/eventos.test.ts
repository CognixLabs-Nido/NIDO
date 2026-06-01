import { describe, expect, it } from 'vitest'

import { confirmarAsistenciaSchema, crearEventoSchema } from '../eventos'

const AULA = '55555555-5555-4555-8555-555555555555'
const NINO = '22222222-2222-4222-8222-222222222222'

const base = {
  tipo: 'excursion' as const,
  titulo: 'Excursión a la granja',
  fecha: '2026-09-10',
}

describe('crearEventoSchema', () => {
  it('acepta un evento de centro sin referencias', () => {
    const r = crearEventoSchema.safeParse({ ambito: 'centro', ...base })
    expect(r.success).toBe(true)
  })

  it('acepta un evento de aula con aula_id', () => {
    const r = crearEventoSchema.safeParse({ ambito: 'aula', aula_id: AULA, ...base })
    expect(r.success).toBe(true)
  })

  it('rechaza ámbito nino sin nino_id', () => {
    const r = crearEventoSchema.safeParse({ ambito: 'nino', ...base })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === 'eventos.validation.nino_requerido')).toBe(
        true
      )
    }
  })

  it('rechaza ámbito aula con nino_id (coherencia)', () => {
    const r = crearEventoSchema.safeParse({ ambito: 'aula', aula_id: AULA, nino_id: NINO, ...base })
    expect(r.success).toBe(false)
  })

  it('rechaza fecha_fin anterior a fecha', () => {
    const r = crearEventoSchema.safeParse({
      ambito: 'centro',
      ...base,
      fecha: '2026-09-10',
      fecha_fin: '2026-09-09',
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === 'eventos.validation.rango_invalido')).toBe(
        true
      )
    }
  })

  it('rechaza hora_fin <= hora_inicio el mismo día', () => {
    const r = crearEventoSchema.safeParse({
      ambito: 'centro',
      ...base,
      hora_inicio: '10:00',
      hora_fin: '09:00',
    })
    expect(r.success).toBe(false)
  })

  it('admite rango con horas (no exige fin>inicio si hay fecha_fin)', () => {
    const r = crearEventoSchema.safeParse({
      ambito: 'centro',
      ...base,
      fecha: '2026-09-10',
      fecha_fin: '2026-09-12',
      hora_inicio: '10:00',
      hora_fin: '09:00',
    })
    expect(r.success).toBe(true)
  })
})

describe('confirmarAsistenciaSchema', () => {
  it('acepta confirmado/rechazado', () => {
    expect(
      confirmarAsistenciaSchema.safeParse({
        evento_id: AULA,
        nino_id: NINO,
        estado: 'confirmado',
      }).success
    ).toBe(true)
    expect(
      confirmarAsistenciaSchema.safeParse({
        evento_id: AULA,
        nino_id: NINO,
        estado: 'rechazado',
      }).success
    ).toBe(true)
  })

  it('rechaza un estado fuera del enum (p.ej. pendiente)', () => {
    expect(
      confirmarAsistenciaSchema.safeParse({
        evento_id: AULA,
        nino_id: NINO,
        estado: 'pendiente',
      }).success
    ).toBe(false)
  })
})
