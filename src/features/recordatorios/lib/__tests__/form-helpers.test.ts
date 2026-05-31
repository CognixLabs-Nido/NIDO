import { describe, expect, it } from 'vitest'

import { VENTANA_ANULACION_MS } from '../constants'
import { datetimeLocalAIso, destinosParaRol, puedeAnular, requiereNino } from '../form-helpers'

const USER = 'user-1'

describe('destinosParaRol', () => {
  it('admin/profe pueden crear familia/personal (no equipo ni direccion en MVP)', () => {
    expect(destinosParaRol('admin')).toEqual(['familia', 'personal'])
    expect(destinosParaRol('profe')).toEqual(['familia', 'personal'])
  })

  it('tutor/autorizado no usan recordatorios en el MVP → lista vacía', () => {
    expect(destinosParaRol('tutor_legal')).toEqual([])
    expect(destinosParaRol('autorizado')).toEqual([])
  })
})

describe('requiereNino', () => {
  it('solo familia y equipo llevan niño', () => {
    expect(requiereNino('familia')).toBe(true)
    expect(requiereNino('equipo')).toBe(true)
    expect(requiereNino('direccion')).toBe(false)
    expect(requiereNino('personal')).toBe(false)
  })
})

describe('puedeAnular — ventana 5 min + emisor', () => {
  const base = { creado_por: USER, erroneo: false, completado_en: null as string | null }
  const now = 1_000_000_000_000

  it('emisor, reciente (<5 min): true', () => {
    const rec = { ...base, created_at: new Date(now - 60_000).toISOString() }
    expect(puedeAnular(rec, USER, now)).toBe(true)
  })

  it('emisor, justo en el borde (>5 min): false', () => {
    const rec = { ...base, created_at: new Date(now - VENTANA_ANULACION_MS - 1).toISOString() }
    expect(puedeAnular(rec, USER, now)).toBe(false)
  })

  it('no emisor: false aunque sea reciente', () => {
    const rec = { ...base, created_at: new Date(now - 60_000).toISOString() }
    expect(puedeAnular(rec, 'otro', now)).toBe(false)
  })

  it('ya anulado o completado: false', () => {
    const recent = new Date(now - 60_000).toISOString()
    expect(puedeAnular({ ...base, erroneo: true, created_at: recent }, USER, now)).toBe(false)
    expect(puedeAnular({ ...base, completado_en: recent, created_at: recent }, USER, now)).toBe(
      false
    )
  })
})

describe('datetimeLocalAIso', () => {
  it('vacío o nulo → null', () => {
    expect(datetimeLocalAIso('')).toBeNull()
    expect(datetimeLocalAIso(null)).toBeNull()
    expect(datetimeLocalAIso(undefined)).toBeNull()
  })

  it('valor válido → ISO con offset Z', () => {
    const iso = datetimeLocalAIso('2026-06-05T09:00')
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('inválido → null', () => {
    expect(datetimeLocalAIso('no-es-fecha')).toBeNull()
  })
})
