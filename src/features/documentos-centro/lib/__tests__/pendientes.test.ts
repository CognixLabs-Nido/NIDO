import { describe, expect, it } from 'vitest'

import { frenaElAlta } from '@/features/alta/lib/regla-documentos-alta'

import { agruparPendientesCentro, laFamiliaLoDebe, type FilaPendienteCentro } from '../pendientes'

/**
 * Lo pendiente de los documentos del centro fuera del alta (fase 4, 4c). Lo que tiene que aguantar:
 * «no existía» no es «no ha firmado» (dos grupos que no se mezclan), un opcional no se reclama, y lo
 * que se reclama a una familia es lo mismo que no le deja cerrar el alta.
 */

const LUCIA = '11111111-1111-4111-8111-111111111111'
const PABLO = '22222222-2222-4222-8222-222222222222'
const NORMAS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PRESU = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OPCIONAL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CURSO_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const CURSO_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const fila = (o: Partial<FilaPendienteCentro>): FilaPendienteCentro => ({
  nino_id: LUCIA,
  documento_id: NORMAS,
  titulo: 'Normas',
  obligatorio: true,
  curso_academico_id: null,
  curso_nombre: null,
  estado: 'por_firmar',
  disponible_desde: '2026-11-03T09:00:00Z',
  ...o,
})

const nombres = new Map([
  [LUCIA, 'Lucía Demo'],
  [PABLO, 'Pablo Demo'],
])

describe('laFamiliaLoDebe', () => {
  it('es la regla del cierre del alta, en los seis casos', () => {
    for (const obligatorio of [true, false])
      for (const estado of ['por_firmar', 'falta_documento', 'firmado']) {
        const d = { obligatorio, estado }
        expect(laFamiliaLoDebe(d), `${obligatorio} ${estado}`).toBe(frenaElAlta(d))
      }
    // Premisa: la comparación no es trivial, la regla dice que sí a uno y no a los demás.
    expect(laFamiliaLoDebe({ obligatorio: true, estado: 'por_firmar' })).toBe(true)
    expect(laFamiliaLoDebe({ obligatorio: false, estado: 'por_firmar' })).toBe(false)
  })
})

describe('agruparPendientesCentro', () => {
  it('por firmar: por documento y curso, con los niños del que lleva más al que menos', () => {
    const r = agruparPendientesCentro(
      [
        fila({ nino_id: LUCIA, disponible_desde: '2026-11-05T09:00:00Z' }),
        fila({ nino_id: PABLO, disponible_desde: '2026-11-03T09:00:00Z' }),
      ],
      nombres
    )
    expect(r.porFirmar).toEqual([
      {
        documentoId: NORMAS,
        titulo: 'Normas',
        cursoNombre: null,
        ninos: [
          { ninoId: PABLO, nombre: 'Pablo Demo', desde: '2026-11-03T09:00:00Z' },
          { ninoId: LUCIA, nombre: 'Lucía Demo', desde: '2026-11-05T09:00:00Z' },
        ],
      },
    ])
    expect(r.sinSubir).toEqual([])
  })

  it('«no existía» no es «no ha firmado»: lo sin subir va aparte, contado, y no como por firmar', () => {
    const r = agruparPendientesCentro(
      [
        fila({ nino_id: LUCIA }),
        fila({
          nino_id: LUCIA,
          documento_id: PRESU,
          titulo: 'Presupuesto',
          estado: 'falta_documento',
          disponible_desde: null,
          curso_academico_id: CURSO_A,
          curso_nombre: '2026-2027',
        }),
        fila({
          nino_id: PABLO,
          documento_id: PRESU,
          titulo: 'Presupuesto',
          estado: 'falta_documento',
          disponible_desde: null,
          curso_academico_id: CURSO_A,
          curso_nombre: '2026-2027',
        }),
      ],
      nombres
    )
    expect(r.porFirmar.map((g) => g.titulo)).toEqual(['Normas'])
    expect(r.sinSubir).toEqual([
      { documentoId: PRESU, titulo: 'Presupuesto', cursoNombre: '2026-2027', ninos: 2 },
    ])
  })

  it('un opcional no se reclama: ni por firmar ni sin subir', () => {
    const r = agruparPendientesCentro(
      [
        fila({ documento_id: OPCIONAL, titulo: 'Excursiones', obligatorio: false }),
        fila({
          documento_id: OPCIONAL,
          titulo: 'Excursiones',
          obligatorio: false,
          estado: 'falta_documento',
          disponible_desde: null,
        }),
      ],
      nombres
    )
    expect(r).toEqual({ porFirmar: [], sinSubir: [] })
  })

  it('el mismo documento en dos cursos son dos grupos, y el grupo que lleva más va primero', () => {
    const r = agruparPendientesCentro(
      [
        fila({
          documento_id: PRESU,
          titulo: 'Presupuesto',
          curso_academico_id: CURSO_B,
          curso_nombre: '2027-2028',
          disponible_desde: '2026-11-06T09:00:00Z',
        }),
        fila({
          documento_id: PRESU,
          titulo: 'Presupuesto',
          curso_academico_id: CURSO_A,
          curso_nombre: '2026-2027',
          disponible_desde: '2026-11-01T09:00:00Z',
        }),
      ],
      nombres
    )
    expect(r.porFirmar.map((g) => g.cursoNombre)).toEqual(['2026-2027', '2027-2028'])
  })

  it('un niño sin nombre leído sale con raya, no se cae de la lista', () => {
    const r = agruparPendientesCentro([fila({ nino_id: PABLO })], new Map())
    expect(r.porFirmar[0]!.ninos).toEqual([
      { ninoId: PABLO, nombre: '—', desde: '2026-11-03T09:00:00Z' },
    ])
  })
})
