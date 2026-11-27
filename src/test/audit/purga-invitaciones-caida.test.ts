import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { clienteConFallos } from '../rls/lectura-fallida'
import {
  asignarRol,
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

import { purgarUno } from '@/features/olvido/actions/purgar-vencidos'

/**
 * MEDIDO ABIERTO (censo C, grupo 1, decisión de Jose del 2026-11-27): «las dos purgas». La del art. 17 redacta
 * el email y el nombre de las invitaciones del sujeto (`purgarUno`, paso 4) con una consulta armada en una
 * variable y esperada después, sin mirar su error (un ciego medido del lint), y sigue a `purgar_sujeto_db`, que
 * marca la petición como purgada. Contra la base efímera; lo único simulado: el UPDATE de `invitaciones`
 * contesta error. Fixtures ficticios del 2026-11-27.
 */

describe('la purga del art. 17 no se da por hecha si las invitaciones no se redactaron (medido abierto)', () => {
  let centro: { id: string }
  const usuarios: TestUser[] = []
  const solicitudes: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Purga Invitaciones')
  }, 120_000)

  afterAll(async () => {
    await serviceClient.from('invitaciones').delete().eq('centro_id', centro.id)
    if (solicitudes.length) {
      await serviceClient.from('olvido_solicitudes').delete().in('id', solicitudes)
    }
    await deleteTestCentro(centro.id)
    for (const u of usuarios) await deleteTestUser(u.id)
  }, 120_000)

  /** Un tutor con una invitación a su email, y su petición de olvido inmediata. */
  async function tutorConInvitacion() {
    const nino = await createTestNino(centro.id)
    const tutor = await createTestUser({ nombre: 'Tutor Purga Invitacion' })
    usuarios.push(tutor)
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal')
    await crearFamiliaTutor(nino.familia_id, tutor.id, 'titular')
    const { data: inv, error: iErr } = await serviceClient
      .from('invitaciones')
      .insert({
        email: tutor.email,
        rol_objetivo: 'tutor_legal',
        centro_id: centro.id,
        nombre_completo: 'Tutor Purga Invitacion',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select('id')
      .single()
    if (iErr || !inv) throw new Error(`invitación: ${iErr?.message}`)
    const { data: sol, error: sErr } = await serviceClient.rpc('solicitar_olvido_usuario', {
      p_usuario_id: tutor.id,
      p_centro_id: centro.id,
      p_inmediato: true,
    })
    if (sErr) throw new Error(`solicitar_olvido_usuario: ${sErr.message}`)
    solicitudes.push(sol as string)
    return { tutor, invId: inv.id, solicitudId: sol as string }
  }

  const pendiente = (t: { tutor: TestUser; solicitudId: string }) => ({
    solicitud_id: t.solicitudId,
    sujeto_tipo: 'usuario' as const,
    sujeto_id: t.tutor.id,
    centro_id: centro.id,
    gracia_hasta: new Date().toISOString(),
  })
  const invitacion = async (id: string) =>
    (
      await serviceClient
        .from('invitaciones')
        .select('email, nombre_completo')
        .eq('id', id)
        .single()
    ).data
  const purgadaEn = async (id: string) =>
    (await serviceClient.from('olvido_solicitudes').select('purgado_en').eq('id', id).single()).data
      ?.purgado_en ?? null

  it('control: sin el fallo, la invitación queda redactada y la petición purgada', async () => {
    const t = await tutorConInvitacion()
    expect((await invitacion(t.invId))?.email, 'premisa: la invitación lleva su email').toBe(
      t.tutor.email
    )
    await purgarUno(serviceClient, pendiente(t))
    expect((await invitacion(t.invId))?.email).not.toBe(t.tutor.email)
    expect(await purgadaEn(t.solicitudId)).not.toBeNull()
  })

  it('con el UPDATE de invitaciones caído: lo que hace la purga (los tres se miden)', async () => {
    const t = await tutorConInvitacion()
    const s = {
      actual: serviceClient,
      fallaTabla: null,
      fallaRpc: null,
      fallidas: 0,
      fallaEscrituraTabla: 'invitaciones',
    }
    let lanzo: string | null = null
    try {
      await purgarUno(clienteConFallos(s), pendiente(t))
    } catch (e) {
      lanzo = e instanceof Error ? e.message : String(e)
    }
    expect(s.fallidas, 'premisa: el UPDATE de invitaciones falló').toBeGreaterThan(0)
    const inv = await invitacion(t.invId)
    const purgada = await purgadaEn(t.solicitudId)
    expect.soft(lanzo, '¿la purga lo dice (lanza)?').not.toBeNull()
    expect.soft(purgada, '¿la petición quedó marcada purgada?').toBeNull()
    expect.soft(inv?.email, '¿la invitación conserva el email?').not.toBe(t.tutor.email)
    console.warn(
      'purga con invitaciones caída:',
      JSON.stringify({
        lanzo,
        purgada: purgada !== null,
        conservaEmail: inv?.email === t.tutor.email,
      })
    )
  })
})
