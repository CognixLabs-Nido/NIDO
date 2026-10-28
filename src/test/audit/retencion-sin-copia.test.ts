import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
  serviceClient,
  type TestNino,
  type TestUser,
} from '../rls/setup'

/**
 * Retención sin copia en audit_log (F11-B, punto 6, PR-2; 20261129120000).
 *
 * Principio: nada vive más en audit_log que en su tabla. Un borrado por plazo pide al trigger
 * de auditoría `app.borrar_sin_copia`: cada DELETE, también los de la cascada, se lleva las
 * copias de su fila (alta, cambios) y no escribe la suya. Sin el ajuste, un DELETE se audita
 * entero, como siempre.
 *
 * Y `purgar_audit_log`: el plazo provisional de audit_log (5 años), simulado o real.
 */

type Fila = { id: string; tabla: string; registro_id: string; accion: string }

async function copiasDe(tabla: string, ids: string[]): Promise<Fila[]> {
  const { data, error } = await serviceClient
    .from('audit_log')
    .select('id, tabla, registro_id, accion')
    .eq('tabla', tabla)
    .in('registro_id', ids)
  expect(error).toBeNull()
  return (data ?? []) as Fila[]
}

describe('Retención sin copia en audit_log', () => {
  let centro: { id: string }
  let admin: TestUser
  let aula: { id: string }
  let nino: TestNino
  let otro: TestNino
  const usuariosExtra: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Retencion Sin Copia')
    admin = await createTestUser({ nombre: 'Admin Retencion Sin Copia' })
    await asignarRol(admin.id, centro.id, 'admin')
    const curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Vencido Sin Copia')
    otro = await createTestNino(centro.id, 'Nino Vivo Sin Copia')
  }, 120_000)

  afterAll(async () => {
    await serviceClient.from('invitaciones').delete().eq('centro_id', centro.id)
    for (const u of usuariosExtra) await deleteTestUser(u)
    await deleteTestUser(admin.id)
    await deleteTestCentro(centro.id)
  }, 120_000)

  async function crearMedia(publicacionId: string, nombre: string): Promise<string> {
    const { data, error } = await serviceClient
      .from('media')
      .insert({
        publicacion_id: publicacionId,
        centro_id: centro.id,
        bucket: 'aula-fotos',
        path: `${centro.id}/${aula.id}/${publicacionId}/${nombre}-${randomUUID()}.jpg`,
        mime: 'image/jpeg',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    return data!.id
  }

  it('control: sin el ajuste, un DELETE con service_role deja su copia en audit_log', async () => {
    const { data: pub } = await serviceClient
      .from('publicaciones')
      .insert({ centro_id: centro.id, aula_id: aula.id, autor_id: admin.id, texto: 'Control' })
      .select('id')
      .single()
    const media = await crearMedia(pub!.id, 'control')
    expect((await copiasDe('media', [media])).map((f) => f.accion)).toEqual(['INSERT'])

    const { error } = await serviceClient.from('media').delete().eq('id', media)
    expect(error).toBeNull()
    expect((await copiasDe('media', [media])).map((f) => f.accion).sort()).toEqual([
      'DELETE',
      'INSERT',
    ])
  })

  it('purgar_fotos_blog_nino: borra las fotos exclusivas y sus etiquetas sin dejar copia', async () => {
    const { data: pub } = await serviceClient
      .from('publicaciones')
      .insert({ centro_id: centro.id, aula_id: aula.id, autor_id: admin.id, texto: 'Blog' })
      .select('id')
      .single()
    const exclusiva = await crearMedia(pub!.id, 'exclusiva')
    const compartida = await crearMedia(pub!.id, 'compartida')
    const { data: etis, error: eErr } = await serviceClient
      .from('media_etiquetas')
      .insert([
        { media_id: exclusiva, nino_id: nino.id, centro_id: centro.id },
        { media_id: compartida, nino_id: nino.id, centro_id: centro.id },
        { media_id: compartida, nino_id: otro.id, centro_id: centro.id },
      ])
      .select('id, media_id, nino_id')
    expect(eErr).toBeNull()
    const delNino = etis!.filter((e) => e.nino_id === nino.id).map((e) => e.id)
    const delOtro = etis!.filter((e) => e.nino_id === otro.id).map((e) => e.id)

    // Premisa: antes de la purga, todas tienen su copia del alta.
    expect(await copiasDe('media', [exclusiva, compartida])).toHaveLength(2)
    expect(await copiasDe('media_etiquetas', [...delNino, ...delOtro])).toHaveLength(3)

    const { error } = await serviceClient.rpc('purgar_fotos_blog_nino', { p_nino_id: nino.id })
    expect(error).toBeNull()

    // La tabla: la exclusiva y las etiquetas del niño se van; la compartida y la del otro, no.
    const { data: quedan } = await serviceClient
      .from('media')
      .select('id')
      .in('id', [exclusiva, compartida])
    expect(quedan?.map((m) => m.id)).toEqual([compartida])
    const { data: etiQuedan } = await serviceClient
      .from('media_etiquetas')
      .select('id')
      .in('id', [...delNino, ...delOtro])
    expect(etiQuedan?.map((e) => e.id)).toEqual(delOtro)

    // audit_log: lo borrado no deja nada, ni el alta ni el DELETE; lo que sigue, su alta.
    expect(await copiasDe('media', [exclusiva])).toEqual([])
    expect(await copiasDe('media_etiquetas', delNino)).toEqual([])
    expect((await copiasDe('media', [compartida])).map((f) => f.accion)).toEqual(['INSERT'])
    expect((await copiasDe('media_etiquetas', delOtro)).map((f) => f.accion)).toEqual(['INSERT'])
  })

  it('purgar_esqueleto_stub_db: la fila de usuarios del stub se va sin dejar copia', async () => {
    const email = `stub-sin-copia-${randomUUID().slice(0, 8)}@nido.test`
    const { data: creado, error: cErr } = await serviceClient.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { nombre_completo: 'Stub Sin Copia' },
    })
    expect(cErr).toBeNull()
    const stub = creado.user!.id
    usuariosExtra.push(stub)
    const { error: iErr } = await serviceClient.from('invitaciones').insert({
      email,
      nombre_completo: 'Stub Sin Copia',
      rol_objetivo: 'tutor_legal',
      centro_id: centro.id,
      nino_id: otro.id,
      tipo_vinculo: 'tutor_legal_principal',
      expires_at: new Date(Date.now() - 40 * 864e5).toISOString(),
    })
    expect(iErr).toBeNull()
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString()

    // Premisa: el stub tiene su fila en usuarios y su copia del alta.
    expect(await copiasDe('usuarios', [stub])).not.toEqual([])

    const { error } = await serviceClient.rpc('purgar_esqueleto_stub_db', {
      p_usuario_id: stub,
      p_cutoff: cutoff,
    })
    expect(error).toBeNull()
    const { data: sigue } = await serviceClient
      .from('usuarios')
      .select('id')
      .eq('id', stub)
      .maybeSingle()
    expect(sigue).toBeNull()
    expect(await copiasDe('usuarios', [stub])).toEqual([])
  })

  it('purgar_esqueleto_stub_db: una cuenta que no es stub no se toca', async () => {
    const confirmado = await createTestUser({ nombre: 'Confirmado Sin Copia' })
    usuariosExtra.push(confirmado.id)
    const { error } = await serviceClient.rpc('purgar_esqueleto_stub_db', {
      p_usuario_id: confirmado.id,
      p_cutoff: new Date().toISOString(),
    })
    expect(error?.code).toBe('23514')
    const { data: sigue } = await serviceClient
      .from('usuarios')
      .select('id')
      .eq('id', confirmado.id)
      .maybeSingle()
    expect(sigue?.id).toBe(confirmado.id)
    expect(await copiasDe('usuarios', [confirmado.id])).not.toEqual([])
  })

  it('purgar_audit_log: simulado cuenta y no borra; real borra solo lo vencido', async () => {
    const dia = 864e5
    const tabla = `prueba_retencion_${randomUUID().slice(0, 8)}`
    const { data: filas, error: iErr } = await serviceClient
      .from('audit_log')
      .insert([
        {
          tabla,
          registro_id: randomUUID(),
          accion: 'INSERT',
          ts: new Date(Date.now() - 6 * 365 * dia).toISOString(),
        },
        {
          tabla,
          registro_id: randomUUID(),
          accion: 'INSERT',
          ts: new Date(Date.now() - 4 * 365 * dia).toISOString(),
        },
      ])
      .select('id, ts')
    expect(iErr).toBeNull()
    const vieja = filas!.find((f) => new Date(f.ts).getTime() < Date.now() - 5 * 365 * dia)!.id
    const reciente = filas!.find((f) => f.id !== vieja)!.id
    const quedan = async () =>
      ((await serviceClient.from('audit_log').select('id').eq('tabla', tabla)).data ?? [])
        .map((f) => f.id)
        .sort()

    const sim = await serviceClient.rpc('purgar_audit_log', { p_anios: 5, p_simular: true })
    expect(sim.error).toBeNull()
    expect(sim.data).toBeGreaterThanOrEqual(1)
    expect(await quedan()).toEqual([vieja, reciente].sort())

    const real = await serviceClient.rpc('purgar_audit_log', { p_anios: 5, p_simular: false })
    expect(real.error).toBeNull()
    expect(real.data).toBeGreaterThanOrEqual(1)
    expect(await quedan()).toEqual([reciente])

    await serviceClient.from('audit_log').delete().eq('tabla', tabla)
  })

  it('con sesión no se ejecuta ninguna de las purgas nuevas', async () => {
    const c = await clientFor(admin)
    const llamadas = [
      await c.rpc('purgar_fotos_blog_nino', { p_nino_id: otro.id }),
      await c.rpc('purgar_esqueleto_stub_db', {
        p_usuario_id: admin.id,
        p_cutoff: new Date().toISOString(),
      }),
      await c.rpc('purgar_audit_log', { p_anios: 1, p_simular: true }),
    ]
    expect(llamadas.map((r) => r.error?.code)).toEqual(['42501', '42501', '42501'])
  })
})
