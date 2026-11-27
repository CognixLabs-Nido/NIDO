import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

import { cursoDeTest } from './curso-de-test'
import { clienteConFallos, type SesionConFallos } from './lectura-fallida'
import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
  FECHA_INCORPORACION_DE_TEST,
} from './setup'

/**
 * MEDIDO ABIERTO (censo C, grupo 1, decisión de Jose del 2026-11-27): «el pase de curso que da de baja a todos
 * los niños del centro si falla una lectura». Dos sitios:
 *  - la APP (`confirmarRollover`): su gate de completitud lee los niños activos; con esa lectura caída, la
 *    lista salía vacía, el gate pasaba y `cerrar_curso` cerraba. El PR A hizo lanzar la lectura.
 *  - la BASE (`cerrar_curso`): da de baja TODA matrícula activa del saliente («pasa de curso»), tenga o no el
 *    niño su sitio en el destino. No comprueba nada: el gate vive solo en la app.
 * Contra la base efímera; lo único simulado es la lectura caída. Fixtures ficticios del 2026-11-27.
 */
const fallos = vi.hoisted(
  () => ({ actual: null, fallaTabla: null, fallaRpc: null, fallidas: 0 }) as SesionConFallos
)
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => clienteConFallos(fallos) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { confirmarRollover } = await import('@/features/pasar-de-curso/actions/confirmar-rollover')

const { inicio: ALTA } = cursoDeTest()

describe('el pase de curso no da de baja a quien no tiene sitio en el destino (medido abierto)', () => {
  let admin: TestUser
  let cAdmin: SupabaseClient<Database>
  const centros: string[] = []

  beforeAll(async () => {
    admin = await createTestUser({ nombre: 'Admin Sin Destino' })
    cAdmin = await clientFor(admin)
  }, 60_000)

  afterAll(async () => {
    for (const id of centros) await deleteTestCentro(id)
    await deleteTestUser(admin.id)
  }, 120_000)

  /** Saliente activo con A (continúa: pendiente en el destino) y B (sin resolver), y el destino planificado. */
  async function escenario() {
    const centro = await createTestCentro('Centro Sin Destino')
    centros.push(centro.id)
    await asignarRol(admin.id, centro.id, 'admin')
    const saliente = await createTestCurso(centro.id, 'activo')
    const destino = await createTestCurso(centro.id, 'planificado')
    const aulaS = await createTestAula(centro.id, saliente.id)
    const aulaD = await createTestAula(centro.id, destino.id)
    const nino = async (nombre: string) => {
      const familiaId = await createTestFamilia(centro.id)
      const { data } = await serviceClient
        .from('ninos')
        .insert({
          centro_id: centro.id,
          familia_id: familiaId,
          nombre,
          primer_apellido: 'Test',
          fecha_nacimiento: '2024-03-15',
          fecha_incorporacion: FECHA_INCORPORACION_DE_TEST,
        })
        .select('id')
        .single()
      await serviceClient.from('matriculas').insert({
        nino_id: data!.id,
        aula_id: aulaS.id,
        curso_academico_id: saliente.id,
        fecha_alta: ALTA,
      })
      return data!.id
    }
    const a = await nino('Nino Continua')
    const b = await nino('Nino Sin Resolver')
    const { error } = await serviceClient.from('matriculas').insert({
      nino_id: a,
      aula_id: aulaD.id,
      curso_academico_id: destino.id,
      estado: 'pendiente',
      fecha_alta: ALTA,
    })
    if (error) throw new Error(`pendiente de A: ${error.message}`)
    return { salienteId: saliente.id, destinoId: destino.id, a, b }
  }

  const estadoCurso = async (id: string) =>
    (await serviceClient.from('cursos_academicos').select('estado').eq('id', id).single()).data
      ?.estado
  const matricula = async (ninoId: string, cursoId: string) =>
    (
      await serviceClient
        .from('matriculas')
        .select('estado')
        .eq('nino_id', ninoId)
        .eq('curso_academico_id', cursoId)
        .is('deleted_at', null)
        .maybeSingle()
    ).data?.estado ?? null

  it('control de la app: sin fallo, el gate para (B sin resolver)', async () => {
    const e = await escenario()
    fallos.actual = cAdmin
    fallos.fallaTabla = null
    const r = await confirmarRollover({ curso_destino_id: e.destinoId })
    expect(r).toEqual({ success: false, error: 'rollover.errors.incompletos' })
    expect(await estadoCurso(e.destinoId)).toBe('planificado')
  })

  it('la app con la lectura de los niños activos caída: no cierra (el PR A)', async () => {
    const e = await escenario()
    fallos.actual = cAdmin
    fallos.fallaTabla = 'matriculas'
    fallos.fallaSoloLaN = 1
    fallos.vistas = 0
    fallos.fallidas = 0
    const r = await confirmarRollover({ curso_destino_id: e.destinoId })
    fallos.fallaTabla = null
    fallos.fallaSoloLaN = null
    expect(fallos.fallidas, 'premisa: la lectura de los niños activos falló').toBeGreaterThan(0)
    expect(r).toEqual({ success: false, error: 'common.lectura_fallida' })
    expect(await estadoCurso(e.destinoId)).toBe('planificado')
    expect(await matricula(e.a, e.salienteId)).toBe('activa')
    expect(await matricula(e.b, e.salienteId)).toBe('activa')
  })

  it('la base: cerrar_curso con un niño sin resolver no cierra ni lo da de baja', async () => {
    const e = await escenario()
    expect(await matricula(e.b, e.salienteId), 'premisa: B está activo en el saliente').toBe(
      'activa'
    )
    expect(await matricula(e.b, e.destinoId), 'premisa: B no tiene sitio en el destino').toBeNull()
    const { data, error } = await cAdmin.rpc('cerrar_curso', { p_curso_destino_id: e.destinoId })
    // Lo que contesta y lo que deja: los cuatro se miden (expect.soft no para).
    expect.soft(error, 'cerrar_curso debería negarse').not.toBeNull()
    expect.soft(await estadoCurso(e.destinoId), 'el destino').toBe('planificado')
    expect.soft(await matricula(e.b, e.salienteId), 'B en el saliente').toBe('activa')
    expect.soft(await matricula(e.a, e.salienteId), 'A en el saliente').toBe('activa')
    console.warn(
      'cerrar_curso con B sin resolver:',
      JSON.stringify({
        data,
        error: error?.message ?? null,
        destino: await estadoCurso(e.destinoId),
        bSaliente: await matricula(e.b, e.salienteId),
        bDestino: await matricula(e.b, e.destinoId),
      })
    )
  })
})
