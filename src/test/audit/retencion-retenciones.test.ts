import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  crearFamiliaTutor,
  crearVinculo,
  createTestCentro,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from '../rls/setup'

/**
 * La retención por procedimiento abierto (F11-B, punto 6, PR-8; 20261206120000).
 *
 * Íñigo está de baja desde 1990: su expediente vence y la purga por plazo lo cogería. Retenido, la
 * purga espera; quitada la retención, vuelve a cogerlo. Solo la titular pone y quita, con motivo, y
 * queda registrado quién, cuándo y por qué: ni la directora, ni la profe, ni el superusuario. Una
 * lista con alguien de otro centro no retiene a nadie.
 *
 * Y el olvido: la madre pide el de Bea. Retenida, la titular no puede confirmarlo y la madre ve
 * en su perfil la petición pendiente, retenida y por qué tipo de motivo. Una petición ya
 * confirmada vuelve a pendiente al retener, y la purga no la coge.
 */

const MOTIVO = 'Oficio 12/2027 del juzgado n.º 3'

describe('Retención: el freno de la destrucción por plazo', () => {
  let centro: { id: string }
  let otroCentro: { id: string }
  let admin: TestUser
  let profe: TestUser
  let directora: TestUser
  let superusuario: TestUser
  let madre: TestUser
  let inigo: string
  let bea: string
  let ajeno: string

  const sujeto = (tipo: 'nino' | 'usuario', id: string) => ({ tipo, id })

  async function poner(u: TestUser, sujetos: unknown, motivo = MOTIVO) {
    const c = await clientFor(u)
    return c.rpc('poner_retencion', {
      p_centro_id: centro.id,
      p_sujetos: sujetos as never,
      p_motivo_tipo: 'juzgado',
      p_motivo: motivo,
    })
  }

  async function quitar(u: TestUser, sujetos: unknown, motivo: string) {
    const c = await clientFor(u)
    return c.rpc('quitar_retencion', {
      p_centro_id: centro.id,
      p_sujetos: sujetos as never,
      p_motivo: motivo,
    })
  }

  async function vencidos(): Promise<string[]> {
    const { data, error } = await serviceClient.rpc('expedientes_vencidos', { p_anios: 5 })
    expect(error).toBeNull()
    return (data ?? []).filter((v) => v.centro_id === centro.id).map((v) => v.nino_id)
  }

  async function filas(): Promise<number> {
    const { count, error } = await serviceClient
      .from('retenciones')
      .select('id', { count: 'exact', head: true })
      .eq('centro_id', centro.id)
    expect(error).toBeNull()
    return count ?? 0
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Retencion Retenciones')
    otroCentro = await createTestCentro('Otro Centro Retencion Retenciones')
    admin = await createTestUser({ nombre: 'Admin Retencion Retenciones' })
    profe = await createTestUser({ nombre: 'Profe Retencion Retenciones' })
    directora = await createTestUser({ nombre: 'Directora Retencion Retenciones' })
    superusuario = await createTestUser({ nombre: 'Super Retencion Retenciones' })
    madre = await createTestUser({ nombre: 'Madre Retencion Retenciones' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(madre.id, centro.id, 'tutor_legal')
    const sp = await serviceClient.from('platform_admins').insert({ usuario_id: superusuario.id })
    expect(sp.error).toBeNull()

    const a = await createTestNino(centro.id, 'Íñigo')
    inigo = a.id
    bea = (await createTestNino(centro.id, 'Bea')).id
    await crearFamiliaTutor(a.familia_id, madre.id, 'titular')
    await crearVinculo(bea, madre.id, 'tutor_legal_principal')
    ajeno = (await createTestNino(otroCentro.id, 'Ajeno')).id

    const b = await serviceClient
      .from('ninos')
      .update({ deleted_at: '1990-01-01T10:00:00+00:00', deleted_reason: 'baja_nino' })
      .eq('id', inigo)
    expect(b.error).toBeNull()
  })

  afterAll(async () => {
    await serviceClient.from('retenciones').delete().eq('centro_id', centro.id)
    await serviceClient.from('olvido_solicitudes').delete().eq('centro_id', centro.id)
    await serviceClient.from('platform_admins').delete().eq('usuario_id', superusuario.id)
    await deleteTestCentro(centro.id)
    await deleteTestCentro(otroCentro.id)
    for (const u of [admin, profe, directora, superusuario, madre]) await deleteTestUser(u.id)
  })

  it('premisa: el expediente de Íñigo ha vencido y nadie está retenido', async () => {
    expect(await vencidos()).toEqual([inigo])
    expect(await filas()).toBe(0)
  })

  it('ni la directora, ni la profe, ni el superusuario ven la lista ni retienen; no queda fila', async () => {
    for (const u of [directora, profe, superusuario]) {
      const c = await clientFor(u)
      const lista = await c.rpc('sujetos_retencion', { p_centro_id: centro.id })
      expect(lista.error?.code).toBe('42501')
      const r = await poner(u, [sujeto('nino', inigo)])
      expect(r.error?.code).toBe('42501')
      const reg = await c.rpc('retenciones_centro', { p_centro_id: centro.id })
      expect(reg.error?.code).toBe('42501')
    }
    expect(await filas()).toBe(0)
  })

  it('la tabla no se lee ni se escribe con sesión, tampoco la titular', async () => {
    const c = await clientFor(admin)
    const sel = await c.from('retenciones').select('id')
    expect(sel.error?.code).toBe('42501')
    const ins = await c.from('retenciones').insert({
      centro_id: centro.id,
      sujeto_tipo: 'nino',
      sujeto_id: inigo,
      motivo_tipo: 'juzgado',
      motivo: MOTIVO,
    })
    expect(ins.error?.code).toBe('42501')
    expect(await filas()).toBe(0)
  })

  it('la titular ve a todos: el niño de baja, la niña en el centro y la madre', async () => {
    const c = await clientFor(admin)
    const { data, error } = await c.rpc('sujetos_retencion', { p_centro_id: centro.id })
    expect(error).toBeNull()
    const porId = new Map((data ?? []).map((s) => [s.sujeto_id, s]))
    expect(porId.get(inigo)).toMatchObject({
      sujeto_tipo: 'nino',
      estado: 'baja',
      desde: '1990-01-01',
    })
    expect(porId.get(bea)).toMatchObject({ sujeto_tipo: 'nino', estado: 'activo', desde: null })
    expect(porId.get(madre.id)).toMatchObject({ sujeto_tipo: 'usuario', estado: 'activo' })
    expect(porId.has(ajeno)).toBe(false)
    expect([...porId.values()].every((s) => s.retenido_desde === null)).toBe(true)
  })

  it('sin motivo válido, o con alguien de otro centro en la lista, no retiene a nadie', async () => {
    const corto = await poner(admin, [sujeto('nino', inigo)], '  corto  ')
    expect(corto.error?.code).toBe('22023')
    expect(corto.error?.hint).toBe('motivo')
    const conAjeno = await poner(admin, [sujeto('nino', inigo), sujeto('nino', ajeno)])
    expect(conAjeno.error?.code).toBe('22023')
    expect(conAjeno.error?.hint).toBe('sujetos')
    const vacia = await poner(admin, [])
    expect(vacia.error?.hint).toBe('sujetos')
    expect(await filas()).toBe(0)
    expect(await vencidos()).toEqual([inigo])
  })

  it('retenido, la purga del expediente espera; otra vez no cuenta', async () => {
    const r = await poner(admin, [sujeto('nino', inigo), sujeto('usuario', madre.id)])
    expect(r.error).toBeNull()
    expect(r.data).toBe(2)
    const otraVez = await poner(admin, [sujeto('nino', inigo)])
    expect(otraVez.data).toBe(0)
    expect(await filas()).toBe(2)

    expect(await vencidos()).toEqual([])
    const purga = await serviceClient.rpc('purgar_expediente_nino', {
      p_nino_id: inigo,
      p_anios: 5,
    })
    expect(purga.error).toBeNull()
    expect(purga.data).toBe(false)
    const n = await serviceClient.from('ninos').select('deleted_reason').eq('id', inigo).single()
    expect(n.data?.deleted_reason).toBe('baja_nino')

    const c = await clientFor(admin)
    const { data } = await c.rpc('sujetos_retencion', { p_centro_id: centro.id })
    const fila = (data ?? []).find((s) => s.sujeto_id === inigo)
    expect(fila?.retenido_desde).not.toBeNull()
    expect(fila?.motivo_tipo).toBe('juzgado')
  })

  it('quitar pide motivo; quitada, la purga vuelve a cogerlo y queda quién, cuándo y por qué', async () => {
    const corto = await quitar(admin, [sujeto('nino', inigo)], 'corto')
    expect(corto.error?.hint).toBe('motivo')
    const dir = await quitar(directora, [sujeto('nino', inigo)], 'Archivado el procedimiento')
    expect(dir.error?.code).toBe('42501')
    expect(await vencidos()).toEqual([])

    const q = await quitar(admin, [sujeto('nino', inigo)], 'Archivado el procedimiento')
    expect(q.error).toBeNull()
    expect(q.data).toBe(1)
    expect(await vencidos()).toEqual([inigo])

    const c = await clientFor(admin)
    const { data: reg, error } = await c.rpc('retenciones_centro', { p_centro_id: centro.id })
    expect(error).toBeNull()
    expect(reg).toHaveLength(2)
    const deInigo = reg!.find((r) => r.sujeto_id === inigo)
    expect(deInigo).toMatchObject({
      motivo_tipo: 'juzgado',
      motivo: MOTIVO,
      puesta_por_nombre: 'Admin Retencion Retenciones',
      quitada_por_nombre: 'Admin Retencion Retenciones',
      quitada_motivo: 'Archivado el procedimiento',
    })
    expect(deInigo?.quitada_en).not.toBeNull()
    expect(reg!.find((r) => r.sujeto_id === madre.id)?.quitada_en).toBeNull()

    // Control positivo: lo que la frenaba era la retención.
    const purga = await serviceClient.rpc('purgar_expediente_nino', {
      p_nino_id: inigo,
      p_anios: 5,
    })
    expect(purga.error).toBeNull()
    expect(purga.data).toBe(true)
  })

  describe('el olvido que pide la familia', () => {
    let peticion: string

    async function estadoParaLaMadre() {
      const c = await clientFor(madre)
      const { data, error } = await c.rpc('mis_peticiones_olvido')
      expect(error).toBeNull()
      return (data ?? []).find((p) => p.id === peticion)
    }

    async function confirmar() {
      const c = await clientFor(admin)
      return c.rpc('confirmar_peticion_olvido', { p_solicitud_id: peticion })
    }

    it('retenida, la petición no se confirma y la madre ve por qué', async () => {
      const c = await clientFor(madre)
      const p = await c.rpc('pedir_olvido_nino', { p_nino_id: bea })
      expect(p.error).toBeNull()
      peticion = p.data as string
      // Premisa: sin retención no le falta nada.
      expect((await estadoParaLaMadre())?.falta).toEqual({ bloqueos: [], avisos: [] })

      expect((await poner(admin, [sujeto('nino', bea)])).data).toBe(1)
      const conf = await confirmar()
      expect(conf.error?.code).toBe('55000')
      expect(conf.error?.hint).toBe('hay_bloqueos')
      const vista = await estadoParaLaMadre()
      expect(vista?.estado).toBe('pendiente')
      expect(vista?.falta).toEqual({
        bloqueos: [{ codigo: 'retenido', n: 1, motivo_tipo: 'juzgado' }],
        avisos: [],
      })
      // El texto del motivo se queda en el centro.
      expect(JSON.stringify(vista)).not.toContain(MOTIVO)
    })

    it('quitada, se confirma; retenida otra vez, vuelve a pendiente con los datos como estaban', async () => {
      expect((await quitar(admin, [sujeto('nino', bea)], 'Archivado el procedimiento')).data).toBe(
        1
      )
      const conf = await confirmar()
      expect(conf.error).toBeNull()
      const archivada = await serviceClient
        .from('ninos')
        .select('deleted_reason')
        .eq('id', bea)
        .single()
      expect(archivada.data?.deleted_reason).toBe('solicitud_olvido')

      expect((await poner(admin, [sujeto('nino', bea)])).data).toBe(1)
      expect((await estadoParaLaMadre())?.estado).toBe('pendiente')
      const viva = await serviceClient.from('ninos').select('deleted_at').eq('id', bea).single()
      expect(viva.data?.deleted_at).toBeNull()
    })

    it('la purga no coge al retenido, ni por la lista ni directamente', async () => {
      const lista = await serviceClient.rpc('olvido_pendientes')
      expect(lista.error).toBeNull()
      expect((lista.data ?? []).map((x) => x.solicitud_id)).not.toContain(peticion)
      const purga = await serviceClient.rpc('purgar_sujeto_db', { p_solicitud_id: peticion })
      expect(purga.error?.code).toBe('55000')
      expect(purga.error?.hint).toBe('retenido')
      const n = await serviceClient.from('ninos').select('deleted_reason').eq('id', bea).single()
      expect(n.data?.deleted_reason).toBeNull()
    })
  })
})
