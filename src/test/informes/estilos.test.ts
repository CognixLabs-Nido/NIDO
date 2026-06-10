import { describe, expect, it } from 'vitest'

import { fondoInforme } from '@/features/informes/lib/estilos'

/**
 * F9-5-3 (fix) — El ámbar solo marca pendientes de un período con campaña ABIERTA;
 * el resto va en gris/neutro para no inundar la lista. Verde = publicado siempre.
 */
describe('fondoInforme', () => {
  it('publicado → verde (independiente de la campaña)', () => {
    expect(fondoInforme('publicado')).toContain('success')
    expect(fondoInforme('publicado', true)).toContain('success')
  })

  it('pendiente (borrador/sin empezar) con campaña abierta → ámbar', () => {
    expect(fondoInforme('borrador', true)).toContain('amber')
    expect(fondoInforme(null, true)).toContain('amber')
  })

  it('pendiente SIN campaña abierta → gris/neutro (ni ámbar ni verde)', () => {
    for (const clases of [
      fondoInforme('borrador', false),
      fondoInforme(null),
      fondoInforme(null, false),
    ]) {
      expect(clases).toContain('muted')
      expect(clases).not.toContain('amber')
      expect(clases).not.toContain('success')
    }
  })
})
