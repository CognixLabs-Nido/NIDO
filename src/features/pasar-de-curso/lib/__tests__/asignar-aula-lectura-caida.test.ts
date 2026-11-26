import { beforeEach, describe, expect, it } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

import { asignarAulaPropuestaCore } from '../mutaciones-rollover'

/**
 * Censo C (B1, 2026-11-26): asignar sala a un niño en la propuesta del curso siguiente. La matrícula del
 * niño en el destino se leía DESPUÉS de sacarlo de «Finaliza» y sin mirar el error: con la lectura caída,
 * «no hay» → insert, que paraba el UNIQUE con un «no se pudo» genérico, con el niño ya fuera de «Finaliza».
 * Y «no está pendiente» se decía también con el niño ya sacado. Ahora se lee antes de escribir nada.
 * Fixtures ficticios.
 */
const estado = {
  matricula: null as { id: string; estado: string } | null,
  matriculaCaida: false,
  escrituras: [] as string[],
}

function cliente() {
  return {
    from: (tabla: string) => {
      let op = 'select'
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is']) c[m] = () => c
      c.delete = () => ((op = 'delete'), c)
      c.update = () => ((op = 'update'), c)
      c.insert = () => ((op = 'insert'), c)
      const responder = () => {
        if (op !== 'select') {
          estado.escrituras.push(`${op} ${tabla}`)
          return { data: { id: 'm-nueva' }, error: null }
        }
        if (tabla === 'cursos_academicos')
          return { data: { estado: 'planificado', centro_id: 'c-1' }, error: null }
        if (tabla === 'aulas_curso') return { data: { aula_id: 'a-1' }, error: null }
        if (tabla === 'matriculas')
          return estado.matriculaCaida
            ? { data: null, error: { code: 'XX000', message: 'caída' } }
            : { data: estado.matricula, error: null }
        return { data: null, error: null }
      }
      c.maybeSingle = async () => responder()
      c.single = async () => responder()
      c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(responder()).then(res, rej)
      return c
    },
  } as never
}

const asignar = () => asignarAulaPropuestaCore(cliente(), 'curso-2', 'n-1', 'a-1')

beforeEach(() => {
  estado.matricula = null
  estado.matriculaCaida = false
  estado.escrituras = []
})

describe('asignarAulaPropuestaCore', () => {
  it('premisa: sin matrícula en el destino, lo saca de «Finaliza» y la crea', async () => {
    expect(await asignar()).toEqual({ success: true, data: { id: 'm-nueva' } })
    expect(estado.escrituras).toEqual(['delete rollover_finaliza', 'insert matriculas'])
  })

  it('con la matrícula sin leer: lanza, y no lo saca de «Finaliza»', async () => {
    estado.matriculaCaida = true
    const e = await asignar().then(
      () => null,
      (err: unknown) => err
    )
    expect(esLecturaFallida(e), `esperaba una LecturaFallida, llegó ${String(e)}`).toBe(true)
    expect(estado.escrituras).toEqual([])
  })

  it('con una matrícula que ya no está pendiente: lo dice sin sacarlo de «Finaliza»', async () => {
    estado.matricula = { id: 'm-1', estado: 'activa' }
    expect(await asignar()).toEqual({ success: false, error: 'rollover.errors.no_pendiente' })
    expect(estado.escrituras).toEqual([])
  })
})
