import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FUENTES_RETENCION } from '@/features/retencion/lib/fuentes-retencion'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from '../rls/setup'

/**
 * El alta que no se termina la confirma Dirección (retención, PR-8, pieza 4; 20261209120000).
 *
 * Leo: invitado a un email mal escrito, sin aceptar. Con la invitación abierta, el botón la cancela
 * y el alta se queda; la invitación nueva corrige el email y se lleva lo del viejo (la invitación,
 * su cuenta de Auth sin confirmar y el email en audit_log). Mar: su tutora aceptó hace 40 días y no
 * terminó; familia nueva: desaparece todo, también la cuenta de la tutora, aunque escribió con su
 * sesión. Ona: hermana de Nil, que ya tuvo matrícula; solo se va su alta. Pau, en `lista`, no entra.
 * La lista es de Dirección; el barrido ya no borra altas solo.
 */

const DIAS = 30
const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString()

describe('El alta sin terminar: la confirma Dirección', () => {
  let centro: { id: string }
  let admin: TestUser
  let directora: TestUser
  let profe: TestUser
  let tutora: TestUser
  let hermano: TestUser
  let aula: string
  let curso: string
  let leo: string
  let famLeo: string
  let mar: string
  let famMar: string
  let nil: string
  let ona: string
  let famOna: string
  let pau: string
  let reciboOna: string
  let stubId: string
  const emailMal = `alta-mal-${Date.now()}@nido.test`
  const emailBueno = `alta-bueno-${Date.now()}@nido.test`

  async function cuenta(tabla: string, columna: string, valor: string): Promise<number> {
    const { count, error } = await serviceClient
      .from(tabla as never)
      .select('id', { count: 'exact', head: true })
      .eq(columna, valor)
    expect(error).toBeNull()
    return count ?? 0
  }

  async function lista(u: TestUser) {
    const c = await clientFor(u)
    return c.rpc('altas_sin_terminar', { p_centro_id: centro.id, p_dias: DIAS })
  }

  async function alta(nombre: string, email: string): Promise<{ nino: string; familia: string }> {
    const c = await clientFor(admin)
    const { data, error } = await c.rpc('crear_o_anadir_a_familia', {
      p_nombre_nino: nombre,
      p_apellidos_nino: 'Alta Ensayo',
      p_fecha_nacimiento: '2025-03-01',
      p_centro_id: centro.id,
      p_aula_id: aula,
      p_tutor_email: email,
      p_tutor_nombre_completo: '',
      p_parentesco: '',
      p_descripcion_parentesco: '',
      p_usuario_id: null as unknown as string,
      p_permisos: {},
    })
    expect(error).toBeNull()
    const r = data as { nino_id: string; familia_id: string }
    return { nino: r.nino_id, familia: r.familia_id }
  }

  async function invitar(nino: string, email: string, expira: string) {
    const { error } = await serviceClient.from('invitaciones').insert({
      centro_id: centro.id,
      email,
      rol_objetivo: 'tutor_legal',
      nino_id: nino,
      tipo_vinculo: 'tutor_legal_principal',
      expires_at: expira,
    })
    expect(error).toBeNull()
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Altas Sin Terminar')
    curso = (await createTestCurso(centro.id)).id
    aula = (await createTestAula(centro.id, curso, 'Patitos Altas', [2025])).id
    admin = await createTestUser({ nombre: 'Admin Altas' })
    directora = await createTestUser({ nombre: 'Directora Altas' })
    profe = await createTestUser({ nombre: 'Profe Altas' })
    tutora = await createTestUser({ nombre: 'Tutora Altas' })
    hermano = await createTestUser({ nombre: 'Tutor Hermano Altas' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(profe.id, centro.id, 'profe')

    // Leo: invitado al email mal escrito; la cuenta de Auth que crea la invitación, sin confirmar.
    ;({ nino: leo, familia: famLeo } = await alta('Leo', emailMal))
    await invitar(leo, emailMal, new Date(Date.now() + 7 * 86_400_000).toISOString())
    const stub = await serviceClient.auth.admin.createUser({
      email: emailMal,
      email_confirm: false,
    })
    expect(stub.error).toBeNull()
    stubId = stub.data.user!.id

    // Mar: la tutora aceptó hace 40 días y no terminó.
    ;({ nino: mar, familia: famMar } = await alta('Mar', tutora.email))
    await invitar(mar, tutora.email, hace(35))
    expect(
      (
        await serviceClient
          .from('invitaciones')
          .update({ accepted_at: hace(40) })
          .eq('nino_id', mar)
      ).error
    ).toBeNull()
    expect(
      (
        await serviceClient
          .from('familia_tutores')
          .update({ usuario_id: tutora.id })
          .eq('familia_id', famMar)
      ).error
    ).toBeNull()
    await asignarRol(tutora.id, centro.id, 'tutor_legal')
    expect(
      (
        await serviceClient.from('vinculos_familiares').insert({
          nino_id: mar,
          usuario_id: tutora.id,
          tipo_vinculo: 'tutor_legal_principal',
          parentesco: 'madre',
        })
      ).error
    ).toBeNull()
    const { data: rm } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: famMar,
        anio: 2026,
        mes: 11,
        total_centimos: 3000,
        estado: 'borrador',
      })
      .select('id')
      .single()
    expect(
      (
        await serviceClient.from('lineas_recibo').insert({
          centro_id: centro.id,
          recibo_id: rm!.id,
          nino_id: mar,
          descripcion: 'Excursión Mar',
          cantidad: 1,
          precio_unitario_centimos: 3000,
          importe_centimos: 3000,
        })
      ).error
    ).toBeNull()
    // Lo que la tutora escribe con su sesión la nombra en audit_log.
    const ct = await clientFor(tutora)
    expect(
      (
        await ct
          .from('usuarios')
          .update({ nombre_completo: 'Tutora Altas Bis' })
          .eq('id', tutora.id)
      ).error
    ).toBeNull()

    // Ona: hermana de Nil (con matrícula activada) en la misma familia, alta a medias de hace 40 días.
    const { data: f3 } = await serviceClient
      .from('familias')
      .insert({ centro_id: centro.id, etiqueta: 'Tres Altas' })
      .select('id')
      .single()
    famOna = f3!.id
    expect(
      (
        await serviceClient.from('familia_tutores').insert({
          familia_id: famOna,
          usuario_id: hermano.id,
          rol_familia: 'titular',
          nombre_completo: 'Tutor Hermano Altas',
        })
      ).error
    ).toBeNull()
    await asignarRol(hermano.id, centro.id, 'tutor_legal')
    const ninos = await serviceClient
      .from('ninos')
      .insert([
        { centro_id: centro.id, nombre: 'Nil', apellidos: 'Tres Altas', familia_id: famOna },
        { centro_id: centro.id, nombre: 'Ona', apellidos: 'Tres Altas', familia_id: famOna },
        { centro_id: centro.id, nombre: 'Pau', apellidos: 'Tres Altas', familia_id: famOna },
      ])
      .select('id, nombre')
    expect(ninos.error).toBeNull()
    nil = ninos.data!.find((n) => n.nombre === 'Nil')!.id
    ona = ninos.data!.find((n) => n.nombre === 'Ona')!.id
    pau = ninos.data!.find((n) => n.nombre === 'Pau')!.id
    expect(
      (
        await serviceClient.from('matriculas').insert([
          {
            nino_id: nil,
            aula_id: aula,
            curso_academico_id: curso,
            estado: 'activa',
            activada_at: hace(400),
          },
          { nino_id: ona, aula_id: aula, curso_academico_id: curso, estado: 'pendiente' },
          { nino_id: pau, aula_id: aula, curso_academico_id: curso, estado: 'lista' },
        ])
      ).error
    ).toBeNull()
    expect(
      (
        await serviceClient.from('vinculos_familiares').insert([
          {
            nino_id: nil,
            usuario_id: hermano.id,
            tipo_vinculo: 'tutor_legal_principal',
            parentesco: 'padre',
          },
          {
            nino_id: ona,
            usuario_id: hermano.id,
            tipo_vinculo: 'tutor_legal_principal',
            parentesco: 'padre',
          },
        ])
      ).error
    ).toBeNull()
    expect(
      (
        await serviceClient
          .from('vinculos_familiares')
          .update({ created_at: hace(40) })
          .eq('nino_id', ona)
      ).error
    ).toBeNull()
    const { data: r3 } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: famOna,
        anio: 2026,
        mes: 11,
        total_centimos: 8000,
        estado: 'borrador',
      })
      .select('id')
      .single()
    reciboOna = r3!.id
    expect(
      (
        await serviceClient.from('lineas_recibo').insert([
          {
            centro_id: centro.id,
            recibo_id: reciboOna,
            nino_id: nil,
            descripcion: 'Escolaridad Nil',
            cantidad: 1,
            precio_unitario_centimos: 5000,
            importe_centimos: 5000,
          },
          {
            centro_id: centro.id,
            recibo_id: reciboOna,
            nino_id: ona,
            descripcion: 'Escolaridad Ona',
            cantidad: 1,
            precio_unitario_centimos: 3000,
            importe_centimos: 3000,
          },
        ])
      ).error
    ).toBeNull()
  })

  afterAll(async () => {
    await serviceClient
      .from('audit_log')
      .delete()
      .eq('tabla', 'alta_sin_terminar')
      .eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    for (const u of [admin, directora, profe, tutora, hermano]) await deleteTestUser(u.id)
    await serviceClient.auth.admin.deleteUser(stubId).catch(() => undefined)
  })

  it('el barrido ya no borra altas solo: no tiene fuente para el alta abandonada', () => {
    expect(FUENTES_RETENCION.length).toBeGreaterThan(0)
    expect(FUENTES_RETENCION.map((f) => f.nombre)).not.toContain('esqueleto-huerfano-nino')
  })

  it('la lista es de Dirección: la admin y la directora la ven; la profe, 42501; Nil y Pau no salen', async () => {
    for (const u of [admin, directora]) {
      const { data, error } = await lista(u)
      expect(error).toBeNull()
      const porNino = new Map((data ?? []).map((a) => [a.nino_id, a]))
      expect(porNino.get(leo)).toMatchObject({
        estado: 'invitacion_abierta',
        propuesta: false,
        familia_nueva: true,
      })
      expect(porNino.get(mar)).toMatchObject({
        estado: 'iniciada',
        propuesta: true,
        familia_nueva: true,
      })
      expect(porNino.get(ona)).toMatchObject({
        estado: 'iniciada',
        propuesta: true,
        familia_nueva: false,
      })
      expect(porNino.has(nil)).toBe(false)
      expect(porNino.has(pau)).toBe(false)
    }
    expect((await lista(profe)).error?.code).toBe('42501')
  })

  it('el botón es solo del servidor, y la base vuelve a mirar quién actúa y qué vio', async () => {
    const c = await clientFor(admin)
    for (const r of [
      await c.rpc('anular_alta', { p_nino_id: leo, p_actor: admin.id, p_accion: 'cancelar' }),
      await c.rpc('datos_anular_alta', { p_nino_id: leo }),
      await c.rpc('reinvitar_alta', { p_nino_id: leo, p_email: emailBueno, p_actor: admin.id }),
    ]) {
      expect(r.error?.code).toBe('42501')
    }
    const deProfe = await serviceClient.rpc('anular_alta', {
      p_nino_id: leo,
      p_actor: profe.id,
      p_accion: 'cancelar',
    })
    expect(deProfe.error?.code).toBe('42501')
    const vieja = await serviceClient.rpc('anular_alta', {
      p_nino_id: leo,
      p_actor: admin.id,
      p_accion: 'borrar',
    })
    expect(vieja.error?.code).toBe('40001')
    expect(await cuenta('ninos', 'id', leo)).toBe(1)
    const enLista = await serviceClient.rpc('anular_alta', {
      p_nino_id: pau,
      p_actor: admin.id,
      p_accion: 'borrar',
    })
    expect(enLista).toMatchObject({ data: null, error: null })
    expect(await cuenta('ninos', 'id', pau)).toBe(1)
  })

  it('Leo: con la invitación abierta, el botón la cancela y el alta se queda', async () => {
    const { data, error } = await serviceClient.rpc('anular_alta', {
      p_nino_id: leo,
      p_actor: directora.id,
      p_accion: 'cancelar',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ accion: 'cancelada', invitaciones: 1 })
    expect(await cuenta('ninos', 'id', leo)).toBe(1)
    const fila = ((await lista(admin)).data ?? []).find((a) => a.nino_id === leo)
    expect(fila).toMatchObject({ estado: 'sin_invitacion', propuesta: false })
  })

  it('Leo: la invitación nueva corrige el email y se lleva lo del viejo', async () => {
    const { data, error } = await serviceClient.rpc('reinvitar_alta', {
      p_nino_id: leo,
      p_email: emailBueno,
      p_actor: directora.id,
    })
    expect(error).toBeNull()
    expect((data as { stubs: string[] }).stubs).toContain(stubId)
    const { data: ft } = await serviceClient
      .from('familia_tutores')
      .select('email')
      .eq('familia_id', famLeo)
    expect(ft?.map((f) => f.email)).toEqual([emailBueno])
    expect(await cuenta('invitaciones', 'nino_id', leo)).toBe(0)
    expect(await cuenta('usuarios', 'id', stubId)).toBe(0)
    const { data: copias } = await serviceClient
      .from('audit_log')
      .select('valores_antes, valores_despues')
      .eq('centro_id', centro.id)
    expect(JSON.stringify(copias)).not.toContain(emailMal)
  })

  it('Mar: familia nueva, desaparece todo, también la cuenta de la tutora', async () => {
    const { data, error } = await serviceClient.rpc('anular_alta', {
      p_nino_id: mar,
      p_actor: directora.id,
      p_accion: 'borrar',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ accion: 'borrada', familia_nueva: true, esperan: 0, familias: 1 })
    expect((data as { cuentas: string[] }).cuentas).toContain(tutora.id)
    expect(await cuenta('ninos', 'id', mar)).toBe(0)
    expect(await cuenta('familias', 'id', famMar)).toBe(0)
    expect(await cuenta('familia_tutores', 'familia_id', famMar)).toBe(0)
    expect(await cuenta('recibos', 'familia_id', famMar)).toBe(0)
    expect(await cuenta('roles_usuario', 'usuario_id', tutora.id)).toBe(0)
    expect(await cuenta('usuarios', 'id', tutora.id)).toBe(0)
    expect(await cuenta('audit_log', 'usuario_id', tutora.id)).toBe(0)
    const { count } = await serviceClient
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .in('registro_id', [mar, famMar])
    expect(count).toBe(0)
  })

  it('Ona: la familia ya tuvo un hijo; solo se va su alta', async () => {
    const { data, error } = await serviceClient.rpc('anular_alta', {
      p_nino_id: ona,
      p_actor: admin.id,
      p_accion: 'borrar',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ accion: 'borrada', familia_nueva: false, lineas: 1 })
    expect(await cuenta('ninos', 'id', ona)).toBe(0)
    expect(await cuenta('ninos', 'id', nil)).toBe(1)
    expect(await cuenta('familias', 'id', famOna)).toBe(1)
    const { data: rec } = await serviceClient
      .from('recibos')
      .select('total_centimos')
      .eq('id', reciboOna)
      .single()
    expect(rec?.total_centimos).toBe(5000)
    expect(await cuenta('usuarios', 'id', hermano.id)).toBe(1)
  })

  it('cada acción deja su evento, con quién y sin datos de la familia', async () => {
    const { data } = await serviceClient
      .from('audit_log')
      .select('usuario_id, valores_antes, valores_despues')
      .eq('tabla', 'alta_sin_terminar')
      .eq('centro_id', centro.id)
    expect(
      (data ?? []).map((e) => (e.valores_despues as { accion: string }).accion).sort()
    ).toEqual(['borrada', 'borrada', 'cancelada', 'reinvitada'])
    expect(new Set((data ?? []).map((e) => e.usuario_id))).toEqual(
      new Set([directora.id, admin.id])
    )
    expect((data ?? []).every((e) => e.valores_antes === null)).toBe(true)
  })
})
