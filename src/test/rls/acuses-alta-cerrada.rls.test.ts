import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * La casilla de las normas, cerrada en la base (fase 4, 4b-2; `20270109120000`).
 *
 * Hasta el 4b-2, `acuses_alta_insert` dejaba al tutor del niño (y desde U-0, a la Dirección de su
 * centro) registrar el acuse de normas por casilla, y el gate lo daba por bueno. Las normas son
 * ahora un documento del centro (decisiones del 2026-11-06): «No mantengas la casilla con una
 * condición: un camino viejo que sobrevive "solo mientras" no se quita nunca». Dos cerrojos, cada uno
 * basta solo (lo midió el ensayo en producción): sin la política de INSERT y sin el privilegio.
 *
 * Las filas que ya hay se quedan y se siguen leyendo: son lo que aceptaron esas familias.
 */
describe('acuses_alta: nadie con sesión escribe la casilla (4b-2)', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let nino: { id: string; centro_id: string; familia_id: string }
  let adminA: TestUser
  let adminB: TestUser
  let tutor: TestUser

  beforeAll(async () => {
    centroA = await createTestCentro('Centro AcusesCerrada A')
    centroB = await createTestCentro('Centro AcusesCerrada B')
    const curso = await createTestCurso(centroA.id)
    const aula = await createTestAula(centroA.id, curso.id)
    nino = await createTestNino(centroA.id, 'Nino AcuseCerrada')
    await matricular(nino.id, aula.id, curso.id)

    adminA = await createTestUser({ nombre: 'Directora A' })
    adminB = await createTestUser({ nombre: 'Directora B' })
    tutor = await createTestUser({ nombre: 'Tutor Legal' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    await asignarRol(adminB.id, centroB.id, 'admin')
    await asignarRol(tutor.id, centroA.id, 'tutor_legal')
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal')

    // Un acuse de antes del 4b-2, del histórico: lo escribe el servidor.
    const { error } = await serviceClient
      .from('acuses_alta')
      .insert({ nino_id: nino.id, centro_id: centroA.id, tipo: 'imagen', firmante_id: tutor.id })
    if (error) throw new Error(`acuse histórico: ${error.message}`)
  })

  afterAll(async () => {
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
    await deleteTestUser(adminA.id)
    await deleteTestUser(adminB.id)
    await deleteTestUser(tutor.id)
  })

  const acusesDe = async (u: TestUser) => {
    const { data, error } = await (await clientFor(u))
      .from('acuses_alta')
      .select('tipo')
      .eq('nino_id', nino.id)
    if (error) throw new Error(error.message)
    return data.map((a) => a.tipo)
  }

  const normas = async (u: TestUser) => {
    const { data, error } = await (await clientFor(u))
      .from('acuses_alta')
      .insert({ nino_id: nino.id, centro_id: centroA.id, tipo: 'normas', firmante_id: u.id })
      .select('id')
      .maybeSingle()
    return { data, code: error?.code ?? null }
  }

  it('premisa: la tutora y la admin son quien la política de antes dejaba, y leen el histórico', async () => {
    // Las dos leen por `acuses_alta_select` (es_tutor_de OR es_admin), la misma condición que la
    // de INSERT de antes. La otra admin, no: la premisa puede fallar.
    expect(await acusesDe(tutor)).toEqual(['imagen'])
    expect(await acusesDe(adminA)).toEqual(['imagen'])
    expect(await acusesDe(adminB)).toEqual([])
  })

  it('ni la tutora ni la admin del centro marcan la casilla de las normas, y no queda fila', async () => {
    for (const u of [tutor, adminA]) {
      expect.soft(await normas(u), u.email).toEqual({ data: null, code: '42501' })
    }
    const { count } = await serviceClient
      .from('acuses_alta')
      .select('id', { count: 'exact', head: true })
      .eq('nino_id', nino.id)
      .eq('tipo', 'normas')
    expect(count).toBe(0)
  })

  it('el rechazo es del privilegio: la sesión no tiene INSERT en la tabla', async () => {
    // Con sesión solo se ve el primer cerrojo que salta, el privilegio («permission denied for
    // table»). Que la política sola también basta lo midió el ensayo en producción devolviendo el
    // privilegio (42501 de la RLS), y lo vigila la guarda posterior de la migración.
    const { error } = await (await clientFor(tutor))
      .from('acuses_alta')
      .insert({ nino_id: nino.id, centro_id: centroA.id, tipo: 'normas', firmante_id: tutor.id })
    expect(error?.code).toBe('42501')
    expect(error?.message).toContain('permission denied for table acuses_alta')
  })
})
