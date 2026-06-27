import { describe, expect, it } from 'vitest'

import { ANIOS_RETENCION_CURSO, fechaLimitePurga } from '../get-cursos-purgables'

/**
 * F11-G-4 — el corte de retención RGPD: un curso es purgable si `fecha_fin <=
 * fechaLimitePurga()`. La fecha límite es hoy menos `ANIOS_RETENCION_CURSO` (5) años. Es
 * lógica sensible (qué datos personales pueden borrarse), por eso se testea con fechas fijas.
 */
describe('fechaLimitePurga', () => {
  it('resta exactamente ANIOS_RETENCION_CURSO años a la fecha de referencia', () => {
    expect(fechaLimitePurga(new Date('2026-06-27T10:00:00Z'))).toBe('2021-06-27')
  })

  it('retención configurada en 5 años', () => {
    expect(ANIOS_RETENCION_CURSO).toBe(5)
  })

  it('un curso con fin justo en el límite es purgable (<=), uno un día después no', () => {
    const limite = fechaLimitePurga(new Date('2026-06-27T00:00:00Z')) // 2021-06-27
    expect('2021-06-27' <= limite).toBe(true) // fin exactamente hace 5 años → purgable
    expect('2021-06-28' <= limite).toBe(false) // un día menos de 5 años → NO purgable
    expect('2020-09-01' <= limite).toBe(true) // curso más antiguo → purgable
  })

  it('maneja el 29 de febrero sin romper (año no bisiesto destino)', () => {
    // 2024-02-29 − 5 años → 2019-02-(28|29 normalizado por Date.UTC) ; comprobamos formato válido
    expect(fechaLimitePurga(new Date('2024-02-29T00:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
