import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { leerPaseServicios } from '@/features/parte-servicio/lib/leer-pase-servicios'

import {
  asignarProfeAula,
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
import { cursoDeTest } from './curso-de-test'

/**
 * PR-12 — el listado único del pase de servicios (`20261115120000`), contra la BD real.
 *
 *  - Cualquier profe del centro (la del aula, la ayudante de otra, una sin aula) lee el listado de
 *    TODOS los niños del centro y apunta el parte de cualquiera, también de otra aula.
 *  - El listado da solo nombre y clase: la ficha de los niños de otras aulas sigue cerrada.
 *  - Fuera: el tutor, la profe de otro centro y la profe dada de baja (42501 / sin filas).
 *  - Una fila no se puede pasar a un niño de otro centro, ni teniendo rol en los dos.
 *  - El parte de un mes cerrado no se edita, con el mensaje que la acción reconoce.
 */

const FECHA = '2026-10-26'

describe('PR-12 — pase de servicios, listado único', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let aula1: { id: string }
  let aula2: { id: string }
  let n1: string
  let n2: string
  let nBaja: string
  let nB: string
  const usuarios: TestUser[] = []
  let profeAula1: TestUser
  let ayudanteAula2: TestUser
  let profeSinAula: TestUser
  let profeB: TestUser
  let profeAyB: TestUser
  let profeDeBaja: TestUser
  let tutor: TestUser
  let admin: TestUser

  async function usuario(nombre: string): Promise<TestUser> {
    const u = await createTestUser({ nombre })
    usuarios.push(u)
    return u
  }

  function fila(ninoId: string, servicio: 'matinera' | 'comedor' | 'vespertina', presente = true) {
    return { centro_id: centroA.id, nino_id: ninoId, fecha: FECHA, servicio, presente }
  }

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Pase Servicios PR12')
    centroB = await createTestCentro('Otro Centro Pase Servicios PR12')
    cursoA = await createTestCurso(centroA.id)
    const cursoB = await createTestCurso(centroB.id)
    aula1 = await createTestAula(centroA.id, cursoA.id, 'Patitos PR12')
    aula2 = await createTestAula(centroA.id, cursoA.id, 'Ositos PR12')
    const aulaB = await createTestAula(centroB.id, cursoB.id)

    n1 = (await createTestNino(centroA.id, 'Nino Aula Uno')).id
    n2 = (await createTestNino(centroA.id, 'Nino Aula Dos')).id
    nBaja = (await createTestNino(centroA.id, 'Nino De Baja')).id
    nB = (await createTestNino(centroB.id, 'Nino Otro Centro')).id
    await matricular(n1, aula1.id, cursoA.id)
    await matricular(n2, aula2.id, cursoA.id)
    const mBaja = await matricular(nBaja, aula1.id, cursoA.id)
    const baja = await serviceClient
      .from('matriculas')
      .update({ fecha_baja: cursoDeTest().fin })
      .eq('id', mBaja)
    expect(baja.error).toBeNull()
    await matricular(nB, aulaB.id, cursoB.id)

    profeAula1 = await usuario('Profe Aula Uno PR12')
    await asignarRol(profeAula1.id, centroA.id, 'profe')
    await asignarProfeAula(profeAula1.id, aula1.id, cursoA.id)

    ayudanteAula2 = await usuario('Ayudante Aula Dos PR12')
    await asignarRol(ayudanteAula2.id, centroA.id, 'profe')
    const asig = await asignarProfeAula(ayudanteAula2.id, aula2.id, cursoA.id)
    const apoyo = await serviceClient
      .from('profes_aulas')
      .update({ tipo_personal_aula: 'apoyo' })
      .eq('id', asig)
    expect(apoyo.error).toBeNull()

    profeSinAula = await usuario('Profe Sin Aula PR12')
    await asignarRol(profeSinAula.id, centroA.id, 'profe')

    profeB = await usuario('Profe Otro Centro PR12')
    await asignarRol(profeB.id, centroB.id, 'profe')

    profeAyB = await usuario('Profe Dos Centros PR12')
    await asignarRol(profeAyB.id, centroA.id, 'profe')
    await asignarRol(profeAyB.id, centroB.id, 'profe')

    profeDeBaja = await usuario('Profe De Baja PR12')
    await asignarRol(profeDeBaja.id, centroA.id, 'profe')
    const deBaja = await serviceClient
      .from('roles_usuario')
      .update({ deleted_at: new Date().toISOString(), deleted_reason: 'baja_temporal' })
      .eq('usuario_id', profeDeBaja.id)
      .eq('centro_id', centroA.id)
    expect(deBaja.error).toBeNull()

    tutor = await usuario('Tutor PR12')
    await asignarRol(tutor.id, centroA.id, 'tutor_legal')
    await crearVinculo(n1, tutor.id, 'tutor_legal_principal')

    admin = await usuario('Admin PR12')
    await asignarRol(admin.id, centroA.id, 'admin')
  }, 120_000)

  afterAll(async () => {
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centroA.id)
    await serviceClient.from('parte_servicio_diario').delete().eq('centro_id', centroA.id)
    await serviceClient.from('parte_servicio_diario').delete().eq('centro_id', centroB.id)
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
    for (const u of usuarios) await deleteTestUser(u.id)
  }, 120_000)

  it('la profe de un aula lee el listado de TODO el centro, con solo nombre y clase', async () => {
    const c = await clientFor(profeAula1)
    // Premisa: la ficha del niño de la otra aula le sigue cerrada.
    const ficha = await c.from('ninos').select('id').eq('id', n2)
    expect(ficha.data ?? []).toEqual([])

    const { data, error } = await c.rpc('listado_pase_servicios', { p_centro_id: centroA.id })
    expect(error).toBeNull()
    expect(new Set((data ?? []).map((r) => r.nino_id))).toEqual(new Set([n1, n2]))
    for (const r of data ?? []) {
      expect(Object.keys(r).sort()).toEqual([
        'apellidos',
        'aula_id',
        'aula_nombre',
        'nino_id',
        'nombre',
      ])
    }
    expect((data ?? []).find((r) => r.nino_id === n2)?.aula_nombre).toBe('Ositos PR12')
    // El niño dado de baja no sale.
    expect((data ?? []).some((r) => r.nino_id === nBaja)).toBe(false)
  })

  it('apunta el parte de un niño de OTRA aula, y lo lee en el listado', async () => {
    const c = await clientFor(profeAula1)
    const { error } = await c
      .from('parte_servicio_diario')
      .upsert([fila(n2, 'comedor'), fila(n2, 'vespertina', false)], {
        onConflict: 'nino_id,fecha,servicio',
      })
    expect(error).toBeNull()
    const filas = await leerPaseServicios(c, centroA.id, FECHA)
    expect(filas.find((f) => f.ninoId === n2)?.servicios).toEqual({
      matinera: null,
      comedor: true,
      vespertina: false,
    })
  })

  it('la ayudante de otra aula y una profe sin aula también lo rellenan', async () => {
    for (const [u, ninoId] of [
      [ayudanteAula2, n1],
      [profeSinAula, n2],
    ] as const) {
      const c = await clientFor(u)
      const { error } = await c
        .from('parte_servicio_diario')
        .upsert([fila(ninoId, 'matinera')], { onConflict: 'nino_id,fecha,servicio' })
      expect(error).toBeNull()
      const filas = await leerPaseServicios(c, centroA.id, FECHA)
      expect(filas.map((f) => f.ninoId).sort()).toEqual([n1, n2].sort())
      expect(filas.find((f) => f.ninoId === ninoId)?.servicios.matinera).toBe(true)
    }
  })

  it('Dirección lee el listado; con centro NULL, 42501', async () => {
    const c = await clientFor(admin)
    const filas = await leerPaseServicios(c, centroA.id, FECHA)
    expect(filas).toHaveLength(2)
    const nulo = await c.rpc('listado_pase_servicios', { p_centro_id: null as unknown as string })
    expect(nulo.error?.code).toBe('42501')
  })

  it('el tutor, la profe de otro centro y la profe de baja: ni listado ni parte', async () => {
    // Control positivo delante: hay partes de este centro.
    const positivo = await (await clientFor(profeAula1))
      .from('parte_servicio_diario')
      .select('id')
      .eq('centro_id', centroA.id)
    expect((positivo.data ?? []).length).toBeGreaterThan(0)

    for (const u of [tutor, profeB, profeDeBaja]) {
      const c = await clientFor(u)
      const listado = await c.rpc('listado_pase_servicios', { p_centro_id: centroA.id })
      expect(listado.error?.code).toBe('42501')
      const leidos = await c.from('parte_servicio_diario').select('id').eq('centro_id', centroA.id)
      expect(leidos.data ?? []).toEqual([])
      const escrito = await c
        .from('parte_servicio_diario')
        .upsert([fila(n1, 'comedor', false)], { onConflict: 'nino_id,fecha,servicio' })
      expect(escrito.error).not.toBeNull()
    }
  })

  it('una fila no pasa a un niño de otro centro, ni con rol de profe en los dos', async () => {
    const c = await clientFor(profeAyB)
    const { data: creada, error } = await c
      .from('parte_servicio_diario')
      .upsert([fila(n1, 'vespertina')], { onConflict: 'nino_id,fecha,servicio' })
      .select('id')
      .single()
    expect(error).toBeNull()
    const movida = await c
      .from('parte_servicio_diario')
      .update({ nino_id: nB })
      .eq('id', creada!.id)
      .select('id')
    expect(movida.error?.code).toBe('42501')
    const { data: sigue } = await serviceClient
      .from('parte_servicio_diario')
      .select('nino_id, centro_id')
      .eq('id', creada!.id)
      .single()
    expect(sigue).toEqual({ nino_id: n1, centro_id: centroA.id })
  })

  it('el parte de un mes cerrado no se edita, con el mensaje que reconoce la acción', async () => {
    const { error: cierre } = await serviceClient
      .from('cierre_mensual')
      .insert({ centro_id: centroA.id, anio: 2026, mes: 3, cerrado_por: admin.id })
    expect(cierre).toBeNull()
    const c = await clientFor(profeAula1)
    const { error } = await c
      .from('parte_servicio_diario')
      .upsert([{ ...fila(n1, 'comedor'), fecha: '2026-03-10' }], {
        onConflict: 'nino_id,fecha,servicio',
      })
    expect(error?.code).toBe('P0001')
    expect(error?.message).toContain('mes cerrado')
  })
})
