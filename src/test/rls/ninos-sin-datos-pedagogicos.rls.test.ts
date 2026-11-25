import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { clienteConFallos, type SesionConFallos } from './lectura-fallida'
import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

vi.mock('server-only', () => ({}))

const { getNinosSinDatosPedagogicos } =
  await import('@/features/datos-pedagogicos/queries/get-ninos-sin-datos-pedagogicos')

/**
 * La lista de Dirección de los niños sin datos pedagógicos (C, 2026-11-24), con los tres casos en los
 * que nadie sabe si el niño toma sólidos: sin registro, registro borrado y lactancia sin contestar.
 * Con la sesión real de la admin del centro. Un niño con la lactancia contestada no sale, aunque le
 * falte otro campo (lo que decide la comida es la lactancia). Y si una lectura falla, la lista no
 * sale vacía («todos los tienen»): sale `null`.
 */
describe('Dirección: los niños sin datos pedagógicos', () => {
  let centroId: string
  let admin: TestUser
  const ids: Record<string, string> = {}
  const sesion: SesionConFallos = { actual: null, fallaTabla: null, fallaRpc: null, fallidas: 0 }

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Sin Datos Pedagogicos Lista')
    centroId = centro.id
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    const casos: Array<[string, Record<string, unknown> | null]> = [
      ['Ana Sinregistro', null],
      ['Bea Borrado', { lactancia_estado: 'finalizada', deleted_at: new Date().toISOString() }],
      ['Ciro Vacia', { lactancia_estado: null }],
      ['Dora Completa', { lactancia_estado: 'mixta' }],
      ['Eva Sinesfinteres', { lactancia_estado: 'finalizada', control_esfinteres: null }],
    ]
    for (const [nombre, datos] of casos) {
      const id = (await createTestNino(centro.id, nombre)).id
      ids[nombre] = id
      await matricular(id, aula.id, curso.id)
      if (datos) {
        const { error } = await serviceClient.from('datos_pedagogicos_nino').insert({
          nino_id: id,
          control_esfinteres: 'panal_completo',
          tipo_alimentacion: 'omnivora',
          idiomas_casa: ['es'],
          tiene_hermanos_en_centro: false,
          ...datos,
        } as never)
        if (error) throw new Error(`datos de ${nombre}: ${error.message}`)
      }
    }
    // Un niño de baja (sin matrícula activa) sin datos no se reclama.
    const baja = (await createTestNino(centro.id, 'Fede Sinmatricula')).id
    ids['Fede Sinmatricula'] = baja
    admin = await createTestUser({ nombre: 'Admin Sin Datos Pedagogicos' })
    await asignarRol(admin.id, centro.id, 'admin')
    sesion.actual = await clientFor(admin)
  }, 120_000)

  afterAll(async () => {
    await serviceClient.from('datos_pedagogicos_nino').delete().in('nino_id', Object.values(ids))
    await deleteTestCentro(centroId)
    if (admin) await deleteTestUser(admin.id)
  }, 90_000)

  afterEach(() => {
    sesion.fallaTabla = null
  })

  it('salen los tres casos, cada uno con el suyo, y nadie más', async () => {
    const borrada = await serviceClient
      .from('datos_pedagogicos_nino')
      .select('deleted_at')
      .eq('nino_id', ids['Bea Borrado'])
      .single()
    expect(borrada.data?.deleted_at, 'premisa: el registro de Bea está borrado').not.toBeNull()

    const lista = await getNinosSinDatosPedagogicos(clienteConFallos(sesion), centroId)
    expect(lista, 'se lee').not.toBeNull()
    expect(lista!.map((n) => [n.nombre, n.caso])).toEqual([
      ['Ana Sinregistro', 'sin_registro'],
      ['Bea Borrado', 'registro_borrado'],
      ['Ciro Vacia', 'lactancia_vacia'],
    ])
  })

  it.each(['matriculas', 'datos_pedagogicos_nino'])(
    'si falla la lectura de %s, la lista no sale vacía: sale null',
    async (tabla) => {
      sesion.fallaTabla = tabla
      sesion.fallidas = 0
      const lista = await getNinosSinDatosPedagogicos(clienteConFallos(sesion), centroId)
      expect(sesion.fallidas, 'premisa: el fallo entró').toBeGreaterThan(0)
      expect(lista).toBeNull()
    }
  )
})
