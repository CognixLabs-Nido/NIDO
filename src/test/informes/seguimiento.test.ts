import { describe, expect, it } from 'vitest'

import {
  derivarSeguimiento,
  type AulaSeed,
  type MatriculaSeed,
} from '@/features/informes/lib/seguimiento'

/**
 * F9-5-1 — Derivación del seguimiento por aula (función pura). Publicados vs
 * pendientes a partir de aulas + matrículas activas + niños con informe publicado.
 * Un borrador o un informe inexistente cuentan como PENDIENTE (sólo «publicado»
 * resta del pendiente). Las bajas no llegan a esta función (las filtra la query).
 */

const AULAS: AulaSeed[] = [
  { id: 'aula-b', nombre: 'Aula Bonsái' },
  { id: 'aula-a', nombre: 'Aula Acuario' },
]

function nino(id: string, nombre: string, apellidos = 'Demo'): MatriculaSeed['nino'] {
  return { id, nombre, apellidos }
}

const MATRICULAS: MatriculaSeed[] = [
  { aula_id: 'aula-a', nino: nino('n1', 'Berta') },
  { aula_id: 'aula-a', nino: nino('n2', 'Ana') },
  { aula_id: 'aula-a', nino: nino('n3', 'Carlos') },
  { aula_id: 'aula-b', nino: nino('n4', 'Diego') },
]

describe('derivarSeguimiento', () => {
  it('cuenta publicados vs pendientes por aula', () => {
    const publicados = new Set(['n1', 'n4']) // Berta (aula-a) y Diego (aula-b)
    const res = derivarSeguimiento(AULAS, MATRICULAS, publicados)

    const aulaA = res.find((a) => a.aulaId === 'aula-a')!
    expect(aulaA.total).toBe(3)
    expect(aulaA.publicados).toBe(1)
    expect(aulaA.pendientes.map((n) => n.id)).toEqual(['n2', 'n3']) // Ana, Carlos

    const aulaB = res.find((a) => a.aulaId === 'aula-b')!
    expect(aulaB.total).toBe(1)
    expect(aulaB.publicados).toBe(1)
    expect(aulaB.pendientes).toHaveLength(0)
  })

  it('un niño sin informe o en borrador es pendiente', () => {
    const res = derivarSeguimiento(AULAS, MATRICULAS, new Set()) // nadie publicado
    const aulaA = res.find((a) => a.aulaId === 'aula-a')!
    expect(aulaA.publicados).toBe(0)
    expect(aulaA.pendientes).toHaveLength(3)
  })

  it('ordena las aulas por nombre y los pendientes por nombre completo', () => {
    const res = derivarSeguimiento(AULAS, MATRICULAS, new Set())
    expect(res.map((a) => a.aulaNombre)).toEqual(['Aula Acuario', 'Aula Bonsái'])
    const aulaA = res.find((a) => a.aulaId === 'aula-a')!
    expect(aulaA.pendientes.map((n) => n.nombre)).toEqual(['Ana', 'Berta', 'Carlos'])
  })

  it('un aula sin matrículas sale con total 0 y sin pendientes', () => {
    const res = derivarSeguimiento([{ id: 'aula-z', nombre: 'Aula Zen' }], [], new Set())
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ total: 0, publicados: 0 })
    expect(res[0].pendientes).toHaveLength(0)
  })

  it('los niños publicados que no están matriculados no afectan a los totales', () => {
    const publicados = new Set(['n-externo']) // no matriculado en ninguna aula
    const res = derivarSeguimiento(AULAS, MATRICULAS, publicados)
    const aulaA = res.find((a) => a.aulaId === 'aula-a')!
    expect(aulaA.publicados).toBe(0)
    expect(aulaA.pendientes).toHaveLength(3)
  })
})
