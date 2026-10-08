import { describe, expect, it } from 'vitest'

import { elegirPrincipal, ordenarConPrincipal, type PersonaAula } from '../personal-principal'

function p(
  nombre: string,
  tipo: PersonaAula['tipo_personal_aula'],
  fecha = '2026-09-01'
): PersonaAula {
  return { nombre_completo: nombre, tipo_personal_aula: tipo, fecha_inicio: fecha }
}

describe('elegirPrincipal', () => {
  it('la profesora es la principal aunque haya coordinadora', () => {
    const coord = p('Ana Coordinadora', 'coordinadora', '2026-01-01')
    const profe = p('Zoe Profesora', 'profesora', '2026-09-01')
    expect(elegirPrincipal([coord, profe, p('Técnico', 'tecnico')])).toBe(profe)
  })

  it('con varias profesoras gana la que lleva más tiempo, no el refuerzo', () => {
    const titular = p('Zoe Titular', 'profesora', '2026-09-01')
    const refuerzo = p('Ana Refuerzo', 'profesora', '2026-11-15')
    expect(elegirPrincipal([refuerzo, titular])).toBe(titular)
  })

  it('con la misma fecha de inicio desempata por orden alfabético', () => {
    const bea = p('Bea', 'profesora', '2026-09-01')
    const ana = p('Ana', 'profesora', '2026-09-01')
    expect(elegirPrincipal([bea, ana])).toBe(ana)
  })

  it('sin profesora, la coordinadora (la más antigua si hay varias)', () => {
    const coordNueva = p('Ana', 'coordinadora', '2026-10-01')
    const coordAntigua = p('Zoe', 'coordinadora', '2026-09-01')
    expect(elegirPrincipal([coordNueva, coordAntigua, p('Apoyo', 'apoyo')])).toBe(coordAntigua)
  })

  it('solo técnico/a y apoyo: nadie es principal', () => {
    expect(elegirPrincipal([p('Técnico', 'tecnico'), p('Apoyo', 'apoyo')])).toBeNull()
  })

  it('aula vacía: nadie', () => {
    expect(elegirPrincipal([])).toBeNull()
  })
})

describe('ordenarConPrincipal', () => {
  it('principal primero; luego profesora, coordinadora, técnico/a, apoyo; alfabético dentro', () => {
    const titular = p('Zoe Titular', 'profesora', '2026-09-01')
    const refuerzo = p('Ana Refuerzo', 'profesora', '2026-11-15')
    const coord = p('Carla', 'coordinadora')
    const tecB = p('Bruno', 'tecnico')
    const tecA = p('Alba', 'tecnico')
    const apoyo = p('Aitor', 'apoyo')
    const personas = [apoyo, tecB, coord, refuerzo, tecA, titular]
    const orden = ordenarConPrincipal(personas, elegirPrincipal(personas))
    expect(orden.map((x) => x.nombre_completo)).toEqual([
      'Zoe Titular',
      'Ana Refuerzo',
      'Carla',
      'Alba',
      'Bruno',
      'Aitor',
    ])
  })

  it('sin principal mantiene el orden por tipo', () => {
    const personas = [p('Bruno', 'apoyo'), p('Ana', 'tecnico')]
    const orden = ordenarConPrincipal(personas, null)
    expect(orden.map((x) => x.nombre_completo)).toEqual(['Ana', 'Bruno'])
  })
})
