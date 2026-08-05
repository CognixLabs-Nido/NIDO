import { describe, expect, it } from 'vitest'

import {
  resolverProspecto,
  type EstadoMatricula,
  type SenalesProspecto,
} from '../acciones-prospecto'

const NINO = '11111111-1111-4111-8111-111111111111'

describe('resolverProspecto (U-4 · D4)', () => {
  it('en_espera sin promover: sigue con Invitar y Completar', () => {
    expect(resolverProspecto({ estado: 'en_espera', ninoId: null, estadoMatricula: null })).toEqual(
      {
        badge: 'en_espera',
        acciones: ['invitar', 'completar'],
      }
    )
  })

  it('promovido con matrícula pendiente: badge de alta en curso y Reanudar', () => {
    expect(
      resolverProspecto({ estado: 'invitado', ninoId: NINO, estadoMatricula: 'pendiente' })
    ).toEqual({ badge: 'alta_en_curso', acciones: ['reanudar'] })
  })

  it('matrícula lista: pendiente de validar, y reanudar sigue siendo útil', () => {
    // El wizard sirve ahí la pantalla "completado, pendiente de validación" con su enlace de
    // edición → es una acción real, no un callejón.
    expect(
      resolverProspecto({ estado: 'invitado', ninoId: NINO, estadoMatricula: 'lista' })
    ).toEqual({ badge: 'pendiente_validar', acciones: ['reanudar', 'ver_ficha'] })
  })

  it('matrícula activa: matriculado; admisiones ya no actúa, solo ficha', () => {
    expect(
      resolverProspecto({ estado: 'invitado', ninoId: NINO, estadoMatricula: 'activa' })
    ).toEqual({ badge: 'matriculado', acciones: ['ver_ficha'] })
  })

  it('matrícula de baja: no se reabre el alta desde admisiones', () => {
    expect(
      resolverProspecto({ estado: 'invitado', ninoId: NINO, estadoMatricula: 'baja' })
    ).toEqual({ badge: 'baja', acciones: ['ver_ficha'] })
  })

  it('REGRESIÓN U-4 — "invitado" que perdió el enlace vuelve a ofrecer promoción', () => {
    // Este era EL prospecto mudo: estado `invitado` sin niño reconstruible (promoción anterior
    // a U-4 o niño borrado con ON DELETE SET NULL). Antes no tenía ningún botón.
    const r = resolverProspecto({ estado: 'invitado', ninoId: null, estadoMatricula: null })
    expect(r.badge).toBe('invitado')
    expect(r.acciones).toEqual(['invitar', 'completar'])
  })

  it('niño enlazado sin matrícula activa: ofrece la ficha, nunca queda mudo', () => {
    const r = resolverProspecto({ estado: 'invitado', ninoId: NINO, estadoMatricula: null })
    expect(r.acciones).toEqual(['ver_ficha'])
  })

  it('INVARIANTE: ninguna combinación de entradas deja al prospecto sin acciones', () => {
    const estados: SenalesProspecto['estado'][] = ['en_espera', 'invitado', 'descartado']
    const ninos: (string | null)[] = [null, NINO]
    const matriculas: (EstadoMatricula | null)[] = [null, 'pendiente', 'lista', 'activa', 'baja']

    const mudos: SenalesProspecto[] = []
    for (const estado of estados) {
      for (const ninoId of ninos) {
        for (const estadoMatricula of matriculas) {
          const senales = { estado, ninoId, estadoMatricula }
          if (resolverProspecto(senales).acciones.length === 0) mudos.push(senales)
        }
      }
    }
    expect(mudos).toEqual([])
  })
})
