import { describe, expect, it } from 'vitest'

import type { ProfeAula } from '../../types'
import { resolverCabeceraTutor } from '../cabecera-tutor'

function profe(nombre: string, es_principal = false): ProfeAula {
  return { usuario_id: nombre, nombre_completo: nombre, es_principal }
}

describe('resolverCabeceraTutor', () => {
  it('con principal muestra su nombre aunque haya más personal', () => {
    const r = resolverCabeceraTutor(
      [profe('Zoe Maestra', true), profe('Carla Coordinadora'), profe('Técnico')],
      'Aula Patitos'
    )
    expect(r).toEqual({ tipo: 'profe', nombre: 'Zoe Maestra' })
  })

  it('sin principal y una sola persona: su nombre', () => {
    expect(resolverCabeceraTutor([profe('Alba Apoyo')], 'Aula Patitos')).toEqual({
      tipo: 'profe',
      nombre: 'Alba Apoyo',
    })
  })

  it('sin principal y varias personas: aula y recuento', () => {
    expect(resolverCabeceraTutor([profe('Alba'), profe('Bruno')], 'Aula Patitos')).toEqual({
      tipo: 'aula_con_profes',
      n: 2,
    })
  })

  it('nadie asignado: el nombre del aula', () => {
    expect(resolverCabeceraTutor([], 'Aula Patitos')).toEqual({ tipo: 'aula_sin_profe' })
  })

  it('ni personal ni aula: el niño (nunca vacía)', () => {
    expect(resolverCabeceraTutor([], null)).toEqual({ tipo: 'nino' })
  })
})
