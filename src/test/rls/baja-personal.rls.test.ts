import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRolDeInvitacion,
  motivoQueImpideElRol,
} from '@/features/centros/contexto/escribir-roles'

import {
  anonClient,
  asignarProfeAula,
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
  type TestAula,
  type TestNino,
  type TestUser,
} from './setup'

/**
 * Baja temporal y salida del centro del personal — `dar_de_baja_profe` y `reactivar_profe`
 * (`20261101130000`). Decisión del responsable: quien no trabaja en el centro no entra y no ve
 * nada. Hasta ahora, sacar a una profe del centro solo cerraba su aula y su rol seguía vivo.
 *
 * Cada «no ve nada» tiene delante su control positivo: la misma profe, con su rol y su aula, sí lo
 * veía. Y la garantía de los helpers: con el rol retirado y una asignación que alguien dejara
 * abierta, tampoco ve a los niños del aula. Los tests de un `describe` van en orden: el estado de
 * uno es el del siguiente.
 */

const ANUNCIO_CENTRO = 'Anuncio de centro (baja del personal)'

describe('baja temporal y salida del centro del personal', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let aula: TestAula
  let nino: TestNino
  let directora: TestUser
  let profe: TestUser
  let otraProfe: TestUser
  let profeFutura: TestUser
  let adminB: TestUser

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Baja Personal A')
    centroB = await createTestCentro('Centro Baja Personal B')
    const curso = await createTestCurso(centroA.id)
    aula = await createTestAula(centroA.id, curso.id)
    nino = await createTestNino(centroA.id)
    await matricular(nino.id, aula.id, curso.id)

    directora = await createTestUser({ nombre: 'Directora Baja' })
    profe = await createTestUser({ nombre: 'Profe Baja' })
    otraProfe = await createTestUser({ nombre: 'Profe Sustituta' })
    profeFutura = await createTestUser({ nombre: 'Profe Futura' })
    adminB = await createTestUser({ nombre: 'Admin Baja B' })
    await asignarRol(directora.id, centroA.id, 'directora')
    await asignarRol(profe.id, centroA.id, 'profe')
    await asignarRol(otraProfe.id, centroA.id, 'profe')
    await asignarRol(profeFutura.id, centroA.id, 'profe')
    await asignarRol(adminB.id, centroB.id, 'admin')

    const asignacion = await asignarProfeAula(profe.id, aula.id, curso.id)
    await serviceClient
      .from('profes_aulas')
      .update({ tipo_personal_aula: 'coordinadora' })
      .eq('id', asignacion)
    await serviceClient.from('profes_aulas').insert({
      profe_id: profeFutura.id,
      aula_id: aula.id,
      curso_academico_id: curso.id,
      fecha_inicio: '2099-01-01',
    })

    await serviceClient
      .from('dias_centro')
      .insert({ centro_id: centroA.id, fecha: '2031-01-06', tipo: 'festivo' })
    await serviceClient.from('anuncios').insert({
      autor_id: directora.id,
      centro_id: centroA.id,
      ambito: 'centro',
      aula_id: null,
      titulo: ANUNCIO_CENTRO,
      contenido: 'Para todo el centro',
    })
  }, 120_000)

  afterAll(async () => {
    for (const u of [directora, profe, otraProfe, profeFutura, adminB]) {
      if (u) await deleteTestUser(u.id)
    }
    for (const c of [centroA, centroB]) if (c) await deleteTestCentro(c.id)
  }, 120_000)

  /** Sus filas `profe` del centro: la viva primero, después las retiradas de la más reciente. */
  async function filasProfe(usuarioId: string) {
    const { data, error } = await serviceClient
      .from('roles_usuario')
      .select('deleted_at, deleted_reason')
      .eq('usuario_id', usuarioId)
      .eq('centro_id', centroA.id)
      .eq('rol', 'profe')
      .order('deleted_at', { ascending: false, nullsFirst: true })
    if (error) throw new Error(error.message)
    return data.map((f) => ({ viva: f.deleted_at === null, motivo: f.deleted_reason }))
  }

  /** La que manda: la viva, o si no hay, la última retirada. */
  async function filaProfe(usuarioId: string) {
    const [primera] = await filasProfe(usuarioId)
    if (!primera) throw new Error('sin fila profe')
    return primera
  }

  async function aulasAbiertas(usuarioId: string): Promise<number> {
    const { count } = await serviceClient
      .from('profes_aulas')
      .select('id', { count: 'exact', head: true })
      .eq('profe_id', usuarioId)
      .is('fecha_fin', null)
      .is('deleted_at', null)
    return count ?? -1
  }

  /** Lo que la profe ve con su sesión: el niño de su aula, el calendario, el anuncio de centro. */
  async function loQueVe(u: TestUser) {
    const c = await clientFor(u)
    const [ninos, dias, anuncios, deAula, deNino] = await Promise.all([
      c.from('ninos').select('id').eq('id', nino.id),
      c.from('dias_centro').select('id').eq('centro_id', centroA.id),
      c.from('anuncios').select('id').eq('titulo', ANUNCIO_CENTRO),
      c.rpc('es_profe_de_aula', { p_aula_id: aula.id }),
      c.rpc('es_profe_de_nino', { p_nino_id: nino.id }),
    ])
    return {
      ninos: ninos.data?.length ?? -1,
      dias: dias.data?.length ?? -1,
      anuncios: anuncios.data?.length ?? -1,
      deAula: deAula.data,
      deNino: deNino.data,
    }
  }

  async function publicaEnSuAula(u: TestUser) {
    const c = await clientFor(u)
    return c
      .from('anuncios')
      .insert({
        autor_id: u.id,
        centro_id: centroA.id,
        ambito: 'aula',
        aula_id: aula.id,
        titulo: 'De la profe',
        contenido: 'Para su aula',
      })
      .select('id')
      .maybeSingle()
  }

  it('premisa (control positivo): con su rol y su aula, la profe ve al niño, el centro y publica', async () => {
    expect(await filaProfe(profe.id)).toEqual({ viva: true, motivo: null })
    expect(await aulasAbiertas(profe.id)).toBe(1)
    expect(await loQueVe(profe)).toEqual({
      ninos: 1,
      dias: 1,
      anuncios: 1,
      deAula: true,
      deNino: true,
    })
    const r = await publicaEnSuAula(profe)
    expect(r.error).toBeNull()
    expect(r.data).not.toBeNull()
  })

  describe('quién da de baja', () => {
    it('una profe no da de baja a otra (42501), y la otra sigue activa', async () => {
      const c = await clientFor(otraProfe)
      const { error } = await c.rpc('dar_de_baja_profe', {
        p_centro_id: centroA.id,
        p_usuario_id: profe.id,
        p_motivo: 'salida_centro',
      })
      expect(error?.code).toBe('42501')
      expect(await filaProfe(profe.id)).toEqual({ viva: true, motivo: null })
    })

    it('la admin de otro centro tampoco (42501)', async () => {
      const c = await clientFor(adminB)
      const { error } = await c.rpc('dar_de_baja_profe', {
        p_centro_id: centroA.id,
        p_usuario_id: profe.id,
        p_motivo: 'salida_centro',
      })
      expect(error?.code).toBe('42501')
      expect(await filaProfe(profe.id)).toEqual({ viva: true, motivo: null })
    })

    it('sin sesión, 42501', async () => {
      const { error } = await anonClient().rpc('dar_de_baja_profe', {
        p_centro_id: centroA.id,
        p_usuario_id: profe.id,
        p_motivo: 'salida_centro',
      })
      expect(error?.code).toBe('42501')
    })

    it('con otro motivo que no es de personal, 22023', async () => {
      const c = await clientFor(directora)
      const { error } = await c.rpc('dar_de_baja_profe', {
        p_centro_id: centroA.id,
        p_usuario_id: profe.id,
        p_motivo: 'purga_rgpd',
      })
      expect(error?.code).toBe('22023')
      expect(await filaProfe(profe.id)).toEqual({ viva: true, motivo: null })
    })

    it('a quien no es personal del centro (la directora), P0002', async () => {
      const c = await clientFor(directora)
      const { error } = await c.rpc('dar_de_baja_profe', {
        p_centro_id: centroA.id,
        p_usuario_id: directora.id,
        p_motivo: 'baja_temporal',
      })
      expect(error?.code).toBe('P0002')
    })
  })

  describe('la baja temporal', () => {
    it('Dirección la da: retira el rol con su motivo y cierra su aula, en una sola llamada', async () => {
      const c = await clientFor(directora)
      const { data, error } = await c.rpc('dar_de_baja_profe', {
        p_centro_id: centroA.id,
        p_usuario_id: profe.id,
        p_motivo: 'baja_temporal',
      })
      expect(error).toBeNull()
      expect(data).toBe(1)
      expect(await filaProfe(profe.id)).toEqual({ viva: false, motivo: 'baja_temporal' })
      expect(await aulasAbiertas(profe.id)).toBe(0)
    })

    it('el puesto de coordinadora queda libre para la sustituta', async () => {
      const { error } = await serviceClient.from('profes_aulas').insert({
        profe_id: otraProfe.id,
        aula_id: aula.id,
        curso_academico_id: aula.curso_academico_id,
        fecha_inicio: '2026-09-01',
        tipo_personal_aula: 'coordinadora',
      })
      expect(error).toBeNull()
    })

    it('de baja no ve nada: ni al niño, ni el calendario, ni el anuncio de centro, ni publica', async () => {
      expect(await loQueVe(profe)).toEqual({
        ninos: 0,
        dias: 0,
        anuncios: 0,
        deAula: false,
        deNino: false,
      })
      const r = await publicaEnSuAula(profe)
      expect(r.error).not.toBeNull()
      expect(r.data).toBeNull()
    })

    it('la garantía: con el rol retirado y su aula reabierta, sigue sin ver al niño', async () => {
      // Lo que haría un camino que solo tocara el rol: la asignación se queda abierta.
      const { error } = await serviceClient
        .from('profes_aulas')
        .update({ fecha_fin: null, tipo_personal_aula: 'profesora' })
        .eq('profe_id', profe.id)
        .eq('aula_id', aula.id)
      expect(error).toBeNull()
      expect(await aulasAbiertas(profe.id)).toBe(1)
      const ve = await loQueVe(profe)
      expect(ve.ninos).toBe(0)
      expect(ve.deAula).toBe(false)
      expect(ve.deNino).toBe(false)
      await serviceClient
        .from('profes_aulas')
        .update({ fecha_fin: '2026-09-01' })
        .eq('profe_id', profe.id)
        .eq('aula_id', aula.id)
      expect(await aulasAbiertas(profe.id)).toBe(0)
    })

    it('una profe no la reactiva (42501)', async () => {
      const c = await clientFor(otraProfe)
      const { error } = await c.rpc('reactivar_profe', {
        p_centro_id: centroA.id,
        p_usuario_id: profe.id,
      })
      expect(error?.code).toBe('42501')
      expect(await filaProfe(profe.id)).toEqual({ viva: false, motivo: 'baja_temporal' })
    })

    it('una invitación no la reactiva: la aceptación lo ve antes de tocar nada', async () => {
      const fila = { usuario_id: profe.id, centro_id: centroA.id, rol: 'profe' as const }
      expect(await motivoQueImpideElRol(serviceClient, fila)).toEqual({
        motivo: 'baja_temporal',
        error: false,
      })
      const { error } = await asignarRolDeInvitacion(serviceClient, fila)
      expect(error).toMatchObject({ code: '55000', hint: 'baja_temporal' })
      expect(await filasProfe(profe.id)).toEqual([{ viva: false, motivo: 'baja_temporal' }])
    })

    it('Dirección la reactiva al volver, sin invitación; el aula se asigna aparte', async () => {
      const c = await clientFor(directora)
      const { error } = await c.rpc('reactivar_profe', {
        p_centro_id: centroA.id,
        p_usuario_id: profe.id,
      })
      expect(error).toBeNull()
      expect(await filaProfe(profe.id)).toEqual({ viva: true, motivo: null })
      const ve = await loQueVe(profe)
      expect(ve.dias).toBe(1)
      expect(ve.ninos).toBe(0)
      expect(ve.deAula).toBe(false)
    })

    it('reactivar a quien ya está activa da P0002', async () => {
      const c = await clientFor(directora)
      const { error } = await c.rpc('reactivar_profe', {
        p_centro_id: centroA.id,
        p_usuario_id: profe.id,
      })
      expect(error?.code).toBe('P0002')
    })

    it('con su rol vivo, una invitación no cambia nada y no da error', async () => {
      const fila = { usuario_id: profe.id, centro_id: centroA.id, rol: 'profe' as const }
      expect(await motivoQueImpideElRol(serviceClient, fila)).toEqual({
        motivo: null,
        error: false,
      })
      const { error } = await asignarRolDeInvitacion(serviceClient, fila)
      expect(error).toBeNull()
      expect(await filaProfe(profe.id)).toEqual({ viva: true, motivo: null })
    })
  })

  describe('la salida del centro', () => {
    it('Dirección la da: retira el rol con salida_centro', async () => {
      const c = await clientFor(directora)
      const { error } = await c.rpc('dar_de_baja_profe', {
        p_centro_id: centroA.id,
        p_usuario_id: profe.id,
        p_motivo: 'salida_centro',
      })
      expect(error).toBeNull()
      expect(await filaProfe(profe.id)).toEqual({ viva: false, motivo: 'salida_centro' })
      expect((await loQueVe(profe)).dias).toBe(0)
    })

    it('no se reactiva desde Personal (55000): vuelve con una invitación', async () => {
      const c = await clientFor(directora)
      const { error } = await c.rpc('reactivar_profe', {
        p_centro_id: centroA.id,
        p_usuario_id: profe.id,
      })
      expect(error?.code).toBe('55000')
      expect(await filaProfe(profe.id)).toEqual({ viva: false, motivo: 'salida_centro' })
    })

    it('si vuelve con una invitación, es un alta nueva: fila nueva y la de la salida intacta', async () => {
      const fila = { usuario_id: profe.id, centro_id: centroA.id, rol: 'profe' as const }
      expect(await motivoQueImpideElRol(serviceClient, fila)).toEqual({
        motivo: null,
        error: false,
      })
      const { error } = await asignarRolDeInvitacion(serviceClient, fila)
      expect(error).toBeNull()
      expect(await filasProfe(profe.id)).toEqual([
        { viva: true, motivo: null },
        { viva: false, motivo: 'salida_centro' },
      ])
    })

    it('con su fila nueva viva, reactivar desde Personal da P0002 (no está de baja)', async () => {
      const c = await clientFor(directora)
      const { error } = await c.rpc('reactivar_profe', {
        p_centro_id: centroA.id,
        p_usuario_id: profe.id,
      })
      expect(error?.code).toBe('P0002')
    })
  })

  it('una asignación que empieza en el futuro se cierra en su fecha de inicio', async () => {
    const c = await clientFor(directora)
    const { data, error } = await c.rpc('dar_de_baja_profe', {
      p_centro_id: centroA.id,
      p_usuario_id: profeFutura.id,
      p_motivo: 'salida_centro',
    })
    expect(error).toBeNull()
    expect(data).toBe(1)
    const { data: fila } = await serviceClient
      .from('profes_aulas')
      .select('fecha_inicio, fecha_fin')
      .eq('profe_id', profeFutura.id)
      .single()
    expect(fila).toEqual({ fecha_inicio: '2099-01-01', fecha_fin: '2099-01-01' })
  })
})
