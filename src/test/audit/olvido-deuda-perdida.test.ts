import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from '../rls/setup'

/**
 * La deuda dada por perdida (PR-B1; 20261212120000).
 *
 * Un impago bloquea el olvido del tutor: su petición se queda pendiente. La admin puede renunciar a
 * esa deuda cuando es lo único que falta: los recibos se marcan sin cambiar su estado, su importe
 * ni su remesa, la renuncia queda en `audit_log` con quien la hizo, y la petición se confirma con
 * sus 7 días de gracia. Deshacer en la gracia devuelve la deuda. Ni la directora ni el
 * superusuario pueden; el importe es el que vio la admin; con un recibo en borrador o en una
 * remesa en borrador, o con otro bloqueo, no se puede. Lo que falta sale también de las
 * confirmadas que esperan en la purga.
 */

const EFECTIVO = 20_000
const DEVUELTO = 14_000
const GASTOS = 300
const DEUDA = EFECTIVO + DEVUELTO + GASTOS

type Deuda = { centimos: number; n: number; perdible: boolean; no_perdible: string | null }
type Falta = { bloqueos: Array<{ codigo: string }> }

describe('Deuda dada por perdida', () => {
  let centro: { id: string }
  let admin: TestUser
  let directora: TestUser
  let superusuario: TestUser
  let tutor: TestUser
  let familia: string
  let peticion: string
  const recibos: string[] = []

  async function recibo(fila: Record<string, unknown>): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({ centro_id: centro.id, familia_id: familia, anio: 2025, ...fila } as never)
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    return (data as { id: string }).id
  }

  async function peticionDeLaAdmin() {
    const c = await clientFor(admin)
    const { data, error } = await c.rpc('peticiones_olvido_centro', { p_centro_id: centro.id })
    expect(error).toBeNull()
    const p = (data ?? []).find((x) => x.id === peticion)
    expect(p).toBeDefined()
    return p!
  }

  async function marcas() {
    const { data, error } = await serviceClient
      .from('recibos')
      .select(
        'id, estado, total_centimos, deuda_perdida_en, deuda_perdida_por, deuda_perdida_solicitud_id'
      )
      .in('id', recibos)
    expect(error).toBeNull()
    return data ?? []
  }

  async function dar(quien: TestUser, centimos: number) {
    const c = await clientFor(quien)
    return c.rpc('dar_deuda_por_perdida', { p_solicitud_id: peticion, p_centimos: centimos })
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Deuda Perdida')
    admin = await createTestUser({ nombre: 'Admin Deuda Perdida' })
    directora = await createTestUser({ nombre: 'Directora Deuda Perdida' })
    superusuario = await createTestUser({ nombre: 'Super Deuda Perdida' })
    tutor = await createTestUser({ nombre: 'Tutora Deuda Perdida' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    const sp = await serviceClient.from('platform_admins').insert({ usuario_id: superusuario.id })
    expect(sp.error).toBeNull()

    // Un hijo sin matrícula viva: lo único que frena el olvido de la tutora es la deuda.
    const nino = await createTestNino(centro.id, 'Nino Deuda Perdida')
    familia = nino.familia_id
    await crearFamiliaTutor(familia, tutor.id, 'titular')

    recibos.push(
      await recibo({
        mes: 3,
        metodo: 'efectivo',
        estado: 'pendiente_procesar',
        total_centimos: EFECTIVO,
      })
    )
    const dev = await recibo({
      mes: 4,
      metodo: 'sepa',
      estado: 'enviado_banco',
      fecha_envio_banco: '2025-04-05',
      total_centimos: DEVUELTO,
    })
    const { error: dErr } = await serviceClient
      .from('recibos')
      .update({
        estado: 'devuelto',
        fecha_devolucion: '2025-04-20',
        devolucion_gastos_centimos: GASTOS,
      })
      .eq('id', dev)
    expect(dErr).toBeNull()
    recibos.push(dev)

    const ct = await clientFor(tutor)
    const { data: id, error } = await ct.rpc('pedir_olvido_usuario', {
      p_usuario_id: tutor.id,
      p_centro_id: centro.id,
    })
    expect(error).toBeNull()
    peticion = id as string
  }, 120_000)

  afterAll(async () => {
    await serviceClient.from('platform_admins').delete().eq('usuario_id', superusuario.id)
    await serviceClient.from('recibos_remesa').delete().eq('centro_id', centro.id)
    await serviceClient.from('remesas').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('retenciones').delete().eq('centro_id', centro.id)
    await serviceClient.from('olvido_solicitudes').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    for (const u of [admin, directora, superusuario, tutor]) await deleteTestUser(u.id)
  }, 120_000)

  it('premisa: la petición espera solo por la deuda, y la admin la ve con su importe', async () => {
    const p = await peticionDeLaAdmin()
    expect(p.estado).toBe('pendiente')
    expect((p.falta as Falta).bloqueos.map((b) => b.codigo)).toEqual(['recibos_pendientes'])
    expect(p.deuda as Deuda).toEqual({
      recibos: expect.any(Array),
      n: 2,
      centimos: DEUDA,
      perdible: true,
      no_perdible: null,
    })
  })

  it('ni la directora ni el superusuario la dan por perdida', async () => {
    for (const quien of [directora, superusuario]) {
      const { error } = await dar(quien, DEUDA)
      expect(error?.code).toBe('42501')
    }
    expect((await marcas()).every((r) => r.deuda_perdida_en === null)).toBe(true)
  })

  it('con otro importe que el que hay, no se toca nada', async () => {
    const { error } = await dar(admin, DEUDA - 1)
    expect(error?.code).toBe('40001')
    expect(error?.hint).toBe('importe_cambiado')
    expect((await marcas()).every((r) => r.deuda_perdida_en === null)).toBe(true)
    expect((await peticionDeLaAdmin()).estado).toBe('pendiente')
  })

  it('con otro bloqueo además de la deuda, no se puede', async () => {
    const c = await clientFor(admin)
    const poner = await c.rpc('poner_retencion', {
      p_centro_id: centro.id,
      p_sujetos: [{ tipo: 'usuario', id: tutor.id }] as never,
      p_motivo_tipo: 'juzgado',
      p_motivo: 'Requerimiento del juzgado de prueba',
    })
    expect(poner.error).toBeNull()
    try {
      expect((await peticionDeLaAdmin()).deuda as Deuda).toMatchObject({
        perdible: false,
        no_perdible: 'otros_bloqueos',
      })
      const { error } = await dar(admin, DEUDA)
      expect(error?.hint).toBe('otros_bloqueos')
    } finally {
      const quitar = await c.rpc('quitar_retencion', {
        p_centro_id: centro.id,
        p_sujetos: [{ tipo: 'usuario', id: tutor.id }] as never,
        p_motivo: 'Fin del procedimiento de prueba',
      })
      expect(quitar.error).toBeNull()
    }
  })

  it('con un recibo en borrador, no se puede: el motor lo rehace', async () => {
    const borrador = await recibo({ mes: 5, estado: 'borrador', total_centimos: 5_000 })
    try {
      expect((await peticionDeLaAdmin()).deuda as Deuda).toMatchObject({
        perdible: false,
        no_perdible: 'recibo_borrador',
      })
      const { error } = await dar(admin, DEUDA + 5_000)
      expect(error?.hint).toBe('recibo_borrador')
    } finally {
      await serviceClient.from('recibos').delete().eq('id', borrador)
    }
  })

  it('la admin renuncia: los recibos quedan igual, marcados y auditados, y la petición, confirmada con gracia', async () => {
    const antes = await marcas()
    const { data, error } = await dar(admin, DEUDA)
    expect(error).toBeNull()
    expect(data).toMatchObject({ recibos: 2, centimos: DEUDA })

    const despues = await marcas()
    for (const r of despues) {
      const a = antes.find((x) => x.id === r.id)!
      expect({ estado: r.estado, total: r.total_centimos }).toEqual({
        estado: a.estado,
        total: a.total_centimos,
      })
      expect(r.deuda_perdida_en).not.toBeNull()
      expect(r.deuda_perdida_por).toBe(admin.id)
      expect(r.deuda_perdida_solicitud_id).toBe(peticion)
    }

    const p = await peticionDeLaAdmin()
    expect(p.estado).toBe('confirmada')
    expect(p.purgado_en).toBeNull()
    // Los 7 días de gracia se mantienen: no se purga en el acto.
    expect(new Date(p.gracia_hasta!).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000)

    const { data: audit, error: aErr } = await serviceClient
      .from('audit_log')
      .select('registro_id, usuario_id, accion, valores_despues')
      .eq('tabla', 'recibos')
      .in('registro_id', recibos)
      .eq('accion', 'UPDATE')
      .eq('usuario_id', admin.id)
    expect(aErr).toBeNull()
    const marcadas = (audit ?? []).filter(
      (a) => (a.valores_despues as Record<string, unknown>)?.deuda_perdida_en
    )
    expect(new Set(marcadas.map((a) => a.registro_id))).toEqual(new Set(recibos))
    expect(
      marcadas.every(
        (a) => (a.valores_despues as Record<string, unknown>).total_centimos !== undefined
      )
    ).toBe(true)
  })

  it('una deuda a la que se renunció no entra en una remesa', async () => {
    const { data: remesa, error } = await serviceClient
      .from('remesas')
      .insert({ centro_id: centro.id, anio: 2025, mes: 3 })
      .select('id')
      .single()
    expect(error).toBeNull()
    const enlace = await serviceClient
      .from('recibos_remesa')
      .insert({ centro_id: centro.id, remesa_id: remesa!.id, recibo_id: recibos[0]! } as never)
    expect(enlace.error?.hint).toBe('deuda_perdida')
  })

  it('la marca no se escribe a mano, ni con el servicio', async () => {
    const { error } = await serviceClient
      .from('recibos')
      .update({ deuda_perdida_en: null, deuda_perdida_por: null, deuda_perdida_solicitud_id: null })
      .eq('id', recibos[0]!)
    expect(error?.hint).toBe('deuda_por_funcion')
  })

  it('una confirmada que espera en la purga dice lo que le falta, a la admin y a la familia', async () => {
    const nuevo = await recibo({
      mes: 6,
      metodo: 'efectivo',
      estado: 'pendiente_procesar',
      total_centimos: 1_000,
    })
    try {
      const p = await peticionDeLaAdmin()
      expect(p.estado).toBe('confirmada')
      expect((p.falta as Falta).bloqueos.map((b) => b.codigo)).toEqual(['recibos_pendientes'])
      const ct = await clientFor(tutor)
      const { data: mias } = await ct.rpc('mis_peticiones_olvido')
      const mia = (mias ?? []).find((m) => m.id === peticion)
      expect((mia?.falta as Falta | undefined)?.bloqueos.map((b) => b.codigo)).toEqual([
        'recibos_pendientes',
      ])
    } finally {
      await serviceClient.from('recibos').delete().eq('id', nuevo)
    }
  })

  it('deshacer la confirmación en la gracia devuelve la deuda', async () => {
    const c = await clientFor(admin)
    const { error } = await c.rpc('deshacer_confirmacion_olvido', { p_solicitud_id: peticion })
    expect(error).toBeNull()
    expect(
      (await marcas()).every((r) => r.deuda_perdida_en === null && r.deuda_perdida_por === null)
    ).toBe(true)
    const p = await peticionDeLaAdmin()
    expect(p.estado).toBe('pendiente')
    expect((p.falta as Falta).bloqueos.map((b) => b.codigo)).toEqual(['recibos_pendientes'])
    expect((p.deuda as Deuda).centimos).toBe(DEUDA)
  })
})
