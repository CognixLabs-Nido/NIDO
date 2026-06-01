import { describe, expect, it } from 'vitest'

import { type CamposMaterialesEvento, huboCambioMaterial } from '../cambios'

const base: CamposMaterialesEvento = {
  fecha: '2026-09-15',
  fecha_fin: null,
  hora_inicio: '09:00:00',
  hora_fin: '13:00:00',
  lugar: 'Granja escuela',
}

describe('huboCambioMaterial', () => {
  it('no hay cambio si los campos materiales son iguales', () => {
    expect(huboCambioMaterial(base, { ...base })).toBe(false)
  })

  it('normaliza horas: HH:MM (formulario) vs HH:MM:SS (Postgres) NO es cambio', () => {
    const nuevo = { ...base, hora_inicio: '09:00', hora_fin: '13:00' }
    expect(huboCambioMaterial(base, nuevo)).toBe(false)
  })

  it('detecta cambio de fecha', () => {
    expect(huboCambioMaterial(base, { ...base, fecha: '2026-09-16' })).toBe(true)
  })

  it('detecta cambio de hora real (no solo el sufijo de segundos)', () => {
    expect(huboCambioMaterial(base, { ...base, hora_inicio: '10:00' })).toBe(true)
  })

  it('detecta cambio de lugar', () => {
    expect(huboCambioMaterial(base, { ...base, lugar: 'Museo' })).toBe(true)
  })

  it('detecta aparición/cambio de fecha_fin (null → fecha)', () => {
    expect(huboCambioMaterial(base, { ...base, fecha_fin: '2026-09-16' })).toBe(true)
  })

  it('trata "" y null de lugar/fecha_fin como equivalentes a ausencia', () => {
    const sinExtras = { ...base, fecha_fin: null, lugar: null }
    expect(huboCambioMaterial(sinExtras, { ...sinExtras })).toBe(false)
  })

  it('un cambio SOLO de campos no materiales (título/tipo) no entra aquí: con material igual, false', () => {
    // huboCambioMaterial ni siquiera recibe título/tipo: si lo material no cambia,
    // el caller no debe notificar aunque el título sí haya cambiado.
    expect(huboCambioMaterial(base, { ...base })).toBe(false)
  })
})
