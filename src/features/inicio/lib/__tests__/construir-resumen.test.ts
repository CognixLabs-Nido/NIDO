import { describe, expect, it } from 'vitest'

import type { CitaAgenda } from '@/features/agenda/types'
import type { DiaCerradoProximo } from '@/features/calendario-centro/types'
import type { EventoCalendario } from '@/features/eventos/types'

import { construirResumen } from '../construir-resumen'
import type { VentanaSemana } from '../ventana-semana'

const VENTANA: VentanaSemana = { hoy: '2026-06-03', desde: '2026-06-01', hasta: '2026-06-07' }

function cita(
  p: Partial<CitaAgenda> & Pick<CitaAgenda, 'id' | 'fecha' | 'hora_inicio'>
): CitaAgenda {
  return {
    tipo: 'reunion_familia',
    titulo: 'Cita',
    descripcion: null,
    lugar: null,
    hora_fin: null,
    estado: 'programada',
    aula_id: null,
    nino_id: null,
    es_organizador: false,
    mi_estado: null,
    ...p,
  }
}

function evento(
  p: Partial<EventoCalendario> & Pick<EventoCalendario, 'id' | 'fecha'>
): EventoCalendario {
  return {
    ambito: 'centro',
    tipo: 'excursion',
    titulo: 'Evento',
    descripcion: null,
    lugar: null,
    fecha_fin: null,
    hora_inicio: null,
    hora_fin: null,
    requiere_confirmacion: false,
    estado: 'programado',
    aula_id: null,
    nino_id: null,
    ...p,
  }
}

function cierre(p: DiaCerradoProximo): DiaCerradoProximo {
  return p
}

describe('construirResumen — mezcla, orden, recorte y partición', () => {
  it('lista vacía cuando no hay datos', () => {
    const r = construirResumen(VENTANA, [], [], [])
    expect(r.hoy).toEqual([])
    expect(r.semana).toEqual([])
    expect(r.desde).toBe('2026-06-01')
    expect(r.hasta).toBe('2026-06-07')
  })

  it('mezcla las 3 fuentes del día y ordena: todo-el-día primero, luego por hora', () => {
    const r = construirResumen(
      VENTANA,
      [cita({ id: 'c1', fecha: '2026-06-03', hora_inicio: '16:30:00', titulo: 'Tutoría' })],
      [evento({ id: 'e1', fecha: '2026-06-03', hora_inicio: '09:00:00', titulo: 'Excursión' })],
      [cierre({ fecha: '2026-06-03', tipo: 'festivo', observaciones: 'San X' })]
    )
    expect(r.hoy.map((i) => [i.kind, i.hora, i.titulo])).toEqual([
      ['cierre', null, 'San X'],
      ['evento', '09:00', 'Excursión'],
      ['cita', '16:30', 'Tutoría'],
    ])
    expect(r.semana).toEqual([])
  })

  it('separa hoy del resto de la semana', () => {
    const r = construirResumen(
      VENTANA,
      [
        cita({ id: 'hoy', fecha: '2026-06-03', hora_inicio: '10:00:00' }),
        cita({ id: 'vie', fecha: '2026-06-05', hora_inicio: '10:00:00' }),
        cita({ id: 'lun', fecha: '2026-06-01', hora_inicio: '10:00:00' }),
      ],
      [],
      []
    )
    expect(r.hoy.map((i) => i.id)).toEqual(['hoy'])
    // resto de la semana en orden cronológico (incluye días ya pasados de la semana)
    expect(r.semana.map((i) => i.id)).toEqual(['lun', 'vie'])
  })

  it('recorta lo que cae fuera de la semana', () => {
    const r = construirResumen(
      VENTANA,
      [
        cita({ id: 'antes', fecha: '2026-05-31', hora_inicio: '10:00:00' }),
        cita({ id: 'dentro', fecha: '2026-06-04', hora_inicio: '10:00:00' }),
        cita({ id: 'despues', fecha: '2026-06-08', hora_inicio: '10:00:00' }),
      ],
      [],
      []
    )
    expect([...r.hoy, ...r.semana].map((i) => i.id)).toEqual(['dentro'])
  })

  it('excluye citas y eventos cancelados', () => {
    const r = construirResumen(
      VENTANA,
      [cita({ id: 'cx', fecha: '2026-06-03', hora_inicio: '10:00:00', estado: 'cancelada' })],
      [evento({ id: 'ex', fecha: '2026-06-04', estado: 'cancelado' })],
      []
    )
    expect([...r.hoy, ...r.semana]).toEqual([])
  })

  it('ancla al lunes un evento multi-día que arranca antes de la semana', () => {
    const r = construirResumen(
      VENTANA,
      [],
      [
        evento({
          id: 'vac',
          fecha: '2026-05-28',
          fecha_fin: '2026-06-05',
          tipo: 'vacaciones',
          titulo: 'Vacaciones',
        }),
      ],
      []
    )
    const item = [...r.hoy, ...r.semana].find((i) => i.id === 'vac')
    expect(item).toBeDefined()
    expect(item?.fecha).toBe('2026-06-01') // recortado al lunes
  })

  it('cierre sin observaciones conserva titulo null (la UI cae al label del tipo)', () => {
    const r = construirResumen(
      VENTANA,
      [],
      [],
      [cierre({ fecha: '2026-06-02', tipo: 'vacaciones', observaciones: null })]
    )
    expect(r.semana[0]).toMatchObject({
      kind: 'cierre',
      titulo: null,
      tipo: 'vacaciones',
      hora: null,
    })
  })
})
