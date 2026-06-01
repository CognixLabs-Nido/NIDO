import { describe, expect, it } from 'vitest'

import { VENTANA_ANULACION_MS } from '../constants'
import {
  datetimeLocalAIso,
  destinosParaRol,
  puedeAnular,
  recordatorioFormDefaults,
  requiereAula,
  requiereNino,
  requiereUsuario,
} from '../form-helpers'

const USER = 'user-1'

describe('destinosParaRol (matriz F6-C)', () => {
  it('admin → los 6 destinos en orden', () => {
    expect(destinosParaRol('admin')).toEqual([
      'familia_individual',
      'familias_aula',
      'familias_centro',
      'profe_individual',
      'profes_centro',
      'personal',
    ])
  })

  it('profe → familia_individual, familias_aula, personal (sin profe_individual/profes_centro/familias_centro)', () => {
    expect(destinosParaRol('profe')).toEqual(['familia_individual', 'familias_aula', 'personal'])
  })

  it('tutor/autorizado solo reciben → lista vacía', () => {
    expect(destinosParaRol('tutor_legal')).toEqual([])
    expect(destinosParaRol('autorizado')).toEqual([])
  })
})

describe('requiereNino / requiereAula / requiereUsuario', () => {
  it('familia_individual lleva niño (solo)', () => {
    expect(requiereNino('familia_individual')).toBe(true)
    expect(requiereAula('familia_individual')).toBe(false)
    expect(requiereUsuario('familia_individual')).toBe(false)
  })

  it('familias_aula lleva aula (solo)', () => {
    expect(requiereAula('familias_aula')).toBe(true)
    expect(requiereNino('familias_aula')).toBe(false)
    expect(requiereUsuario('familias_aula')).toBe(false)
  })

  it('profe_individual lleva usuario (solo)', () => {
    expect(requiereUsuario('profe_individual')).toBe(true)
    expect(requiereNino('profe_individual')).toBe(false)
    expect(requiereAula('profe_individual')).toBe(false)
  })

  it('familias_centro / profes_centro / personal no llevan referencia', () => {
    for (const d of ['familias_centro', 'profes_centro', 'personal'] as const) {
      expect(requiereNino(d)).toBe(false)
      expect(requiereAula(d)).toBe(false)
      expect(requiereUsuario(d)).toBe(false)
    }
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

describe('recordatorioFormDefaults — preselección contextual (F6-C-3)', () => {
  const ADMIN = destinosParaRol('admin')
  const PROFE = destinosParaRol('profe')

  it('sin preset → primer destino del rol, referencias a null', () => {
    expect(recordatorioFormDefaults(ADMIN)).toMatchObject({
      destinatario: 'familia_individual',
      nino_id: null,
      aula_id: null,
      usuario_destinatario_id: null,
    })
  })

  it('sin destinos (caso defensivo) → personal', () => {
    expect(recordatorioFormDefaults([]).destinatario).toBe('personal')
  })

  it('preset ficha de niño → familia_individual + nino_id preseleccionados', () => {
    const d = recordatorioFormDefaults(ADMIN, {
      destinatario: 'familia_individual',
      nino_id: 'nino-123',
    })
    expect(d).toMatchObject({
      destinatario: 'familia_individual',
      nino_id: 'nino-123',
      aula_id: null,
    })
  })

  it('preset aula → familias_aula + aula_id preseleccionados (rol profe)', () => {
    const d = recordatorioFormDefaults(PROFE, {
      destinatario: 'familias_aula',
      aula_id: 'aula-9',
    })
    expect(d).toMatchObject({
      destinatario: 'familias_aula',
      aula_id: 'aula-9',
      nino_id: null,
    })
  })

  it('titulo/descripcion/vencimiento siempre vacíos', () => {
    const d = recordatorioFormDefaults(ADMIN, { destinatario: 'familias_centro' })
    expect(d.titulo).toBe('')
    expect(d.descripcion).toBe('')
    expect(d.vencimiento).toBe('')
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
