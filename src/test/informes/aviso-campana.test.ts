import { describe, expect, it } from 'vitest'

import {
  consolidarAvisoCampana,
  diasHastaFecha,
  type CampanaPendienteEntry,
} from '@/features/informes/lib/aviso-campana'

/**
 * F9-5-2 — Lógica pura del aviso de pendientes de campaña en el INICIO de la profe.
 * Consolida varias campañas abiertas en un solo aviso (Q1) y calcula la urgencia por
 * la fecha límite más próxima (Q9: umbral 3 días naturales, o vencida).
 */

const HOY = '2026-06-10'

describe('diasHastaFecha', () => {
  it('cuenta días naturales (futuro positivo, hoy 0, pasado negativo)', () => {
    expect(diasHastaFecha('2026-06-20', HOY)).toBe(10)
    expect(diasHastaFecha('2026-06-10', HOY)).toBe(0)
    expect(diasHastaFecha('2026-06-07', HOY)).toBe(-3)
  })

  it('cruza fin de mes correctamente', () => {
    expect(diasHastaFecha('2026-07-01', '2026-06-30')).toBe(1)
  })
})

describe('consolidarAvisoCampana', () => {
  it('devuelve null si no hay ningún pendiente', () => {
    const entries: CampanaPendienteEntry[] = [
      { fechaLimite: '2026-06-30', pendientes: 0 },
      { fechaLimite: '2026-12-20', pendientes: 0 },
    ]
    expect(consolidarAvisoCampana(entries, HOY)).toBeNull()
  })

  it('devuelve null con lista vacía', () => {
    expect(consolidarAvisoCampana([], HOY)).toBeNull()
  })

  it('suma los pendientes de las campañas con trabajo (Q1)', () => {
    const r = consolidarAvisoCampana(
      [
        { fechaLimite: '2026-12-20', pendientes: 2 },
        { fechaLimite: '2027-03-20', pendientes: 3 },
      ],
      HOY
    )
    expect(r?.n).toBe(5)
  })

  it('usa la fecha límite MÁS PRÓXIMA entre las que tienen pendientes', () => {
    const r = consolidarAvisoCampana(
      [
        { fechaLimite: '2027-03-20', pendientes: 1 },
        { fechaLimite: '2026-12-20', pendientes: 1 },
      ],
      HOY
    )
    expect(r?.fechaLimite).toBe('2026-12-20')
  })

  it('ignora la fecha de una campaña sin pendientes aunque sea más próxima', () => {
    const r = consolidarAvisoCampana(
      [
        { fechaLimite: '2026-06-12', pendientes: 0 }, // más próxima pero sin pendientes
        { fechaLimite: '2026-12-20', pendientes: 4 },
      ],
      HOY
    )
    expect(r?.fechaLimite).toBe('2026-12-20')
    expect(r?.urgente).toBe(false)
  })

  it('NO es urgente con margen (>3 días)', () => {
    const r = consolidarAvisoCampana([{ fechaLimite: '2026-06-20', pendientes: 1 }], HOY)
    expect(r?.urgente).toBe(false)
    expect(r?.vencida).toBe(false)
  })

  it('es urgente justo en el umbral de 3 días', () => {
    const r = consolidarAvisoCampana([{ fechaLimite: '2026-06-13', pendientes: 1 }], HOY)
    expect(r?.urgente).toBe(true)
    expect(r?.vencida).toBe(false)
  })

  it('es urgente y vencida si la fecha ya pasó', () => {
    const r = consolidarAvisoCampana([{ fechaLimite: '2026-06-05', pendientes: 1 }], HOY)
    expect(r?.urgente).toBe(true)
    expect(r?.vencida).toBe(true)
  })
})
