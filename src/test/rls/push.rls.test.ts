import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { clientFor, createTestUser, deleteTestUser, serviceClient, type TestUser } from './setup'

/**
 * RLS de `push_subscriptions` (Fase 5.5). Aislamiento estricto por usuario:
 * cada uno solo puede leer/insertar/actualizar/borrar sus propias filas
 * (`usuario_id = auth.uid()`). El motor de envío usa service role para
 * bypass — ese flujo se cubre en los tests unit de `enviar-push`.
 */
describe('RLS — public.push_subscriptions', () => {
  let userA: TestUser
  let userB: TestUser
  let subAId: string

  function endpointPara(user: TestUser): string {
    return `https://fcm.googleapis.com/fcm/send/rls-${user.id}-${Date.now()}`
  }

  beforeAll(async () => {
    userA = await createTestUser({ nombre: 'Push User A' })
    userB = await createTestUser({ nombre: 'Push User B' })

    // Sembramos una suscripción de A vía service role para los tests de SELECT.
    const { data, error } = await serviceClient
      .from('push_subscriptions')
      .insert({
        usuario_id: userA.id,
        endpoint: endpointPara(userA),
        p256dh: 'p256dh-seed-A',
        auth: 'auth-seed-A',
        user_agent: 'rls-test',
      })
      .select('id')
      .single()
    if (error || !data) {
      throw new Error(`seed sub A falló: ${error?.message}`)
    }
    subAId = data.id
  }, 60_000)

  afterAll(async () => {
    // Limpieza explícita por si los tests dejan filas. El ON DELETE CASCADE
    // de `usuarios` se ejercitará en su propio test al final.
    await serviceClient.from('push_subscriptions').delete().eq('usuario_id', userA.id)
    await serviceClient.from('push_subscriptions').delete().eq('usuario_id', userB.id)
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  }, 60_000)

  it('un usuario lee su propia suscripción', async () => {
    const client = await clientFor(userA)
    const { data, error } = await client
      .from('push_subscriptions')
      .select('id, usuario_id')
      .eq('id', subAId)
      .maybeSingle()

    expect(error).toBeNull()
    expect(data?.id).toBe(subAId)
    expect(data?.usuario_id).toBe(userA.id)
  })

  it('un usuario NO ve la suscripción de otro (SELECT)', async () => {
    const client = await clientFor(userB)
    const { data, error } = await client
      .from('push_subscriptions')
      .select('id')
      .eq('id', subAId)
      .maybeSingle()

    // RLS oculta la fila → data null y sin error.
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('un usuario no puede INSERT con usuario_id de otro', async () => {
    const client = await clientFor(userB)
    const { error } = await client.from('push_subscriptions').insert({
      usuario_id: userA.id, // suplantación
      endpoint: endpointPara(userA) + '-suplantado',
      p256dh: 'p256dh-bad',
      auth: 'auth-bad',
    })

    expect(error).not.toBeNull()
    // 42501 = insufficient_privilege (RLS denial).
    expect(error?.code).toBe('42501')
  })

  it('un usuario puede INSERT su propia suscripción', async () => {
    const client = await clientFor(userB)
    const endpoint = endpointPara(userB)
    const { data, error } = await client
      .from('push_subscriptions')
      .insert({
        usuario_id: userB.id,
        endpoint,
        p256dh: 'p256dh-B',
        auth: 'auth-B',
      })
      .select('id, endpoint')
      .single()

    expect(error).toBeNull()
    expect(data?.endpoint).toBe(endpoint)
  })

  it('un usuario no puede UPDATE la suscripción de otro', async () => {
    const client = await clientFor(userB)
    const { data, error } = await client
      .from('push_subscriptions')
      .update({ user_agent: 'hackeado' })
      .eq('id', subAId)
      .select('id')

    // La RLS oculta la fila al UPDATE: data vacío, sin error explícito.
    expect(error).toBeNull()
    expect(data).toEqual([])

    // Confirmamos vía service role que la fila NO se modificó.
    const { data: row } = await serviceClient
      .from('push_subscriptions')
      .select('user_agent')
      .eq('id', subAId)
      .maybeSingle()
    expect(row?.user_agent).toBe('rls-test')
  })

  it('un usuario no puede DELETE la suscripción de otro', async () => {
    const client = await clientFor(userB)
    const { error, count } = await client
      .from('push_subscriptions')
      .delete({ count: 'exact' })
      .eq('id', subAId)

    expect(error).toBeNull()
    expect(count).toBe(0)

    // Verificamos que la fila sigue existiendo.
    const { data: row } = await serviceClient
      .from('push_subscriptions')
      .select('id')
      .eq('id', subAId)
      .maybeSingle()
    expect(row?.id).toBe(subAId)
  })

  it('un usuario puede DELETE su propia suscripción', async () => {
    const endpoint = endpointPara(userA) + '-temp'
    const { data: inserted } = await serviceClient
      .from('push_subscriptions')
      .insert({
        usuario_id: userA.id,
        endpoint,
        p256dh: 'p256dh-tmp',
        auth: 'auth-tmp',
      })
      .select('id')
      .single()
    if (!inserted) throw new Error('seed temp sub failed')

    const client = await clientFor(userA)
    const { error, count } = await client
      .from('push_subscriptions')
      .delete({ count: 'exact' })
      .eq('id', inserted.id)

    expect(error).toBeNull()
    expect(count).toBe(1)
  })

  it('el UNIQUE(usuario_id, endpoint) impide duplicar suscripciones del mismo navegador', async () => {
    const endpoint = endpointPara(userA) + '-unique'
    const { error: e1 } = await serviceClient.from('push_subscriptions').insert({
      usuario_id: userA.id,
      endpoint,
      p256dh: 'p256dh-1',
      auth: 'auth-1',
    })
    expect(e1).toBeNull()
    const { error: e2 } = await serviceClient.from('push_subscriptions').insert({
      usuario_id: userA.id,
      endpoint,
      p256dh: 'p256dh-2',
      auth: 'auth-2',
    })
    expect(e2).not.toBeNull()
    expect(e2?.code).toBe('23505')

    await serviceClient
      .from('push_subscriptions')
      .delete()
      .eq('usuario_id', userA.id)
      .eq('endpoint', endpoint)
  })

  it('CASCADE: al borrar el usuario, se borran sus suscripciones', async () => {
    const tmpUser = await createTestUser({ nombre: 'Cascade User' })
    const endpoint = endpointPara(tmpUser)
    const { data: ins, error } = await serviceClient
      .from('push_subscriptions')
      .insert({
        usuario_id: tmpUser.id,
        endpoint,
        p256dh: 'p256dh-cascade',
        auth: 'auth-cascade',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    const subId = ins!.id

    await deleteTestUser(tmpUser.id)

    const { data: row } = await serviceClient
      .from('push_subscriptions')
      .select('id')
      .eq('id', subId)
      .maybeSingle()
    expect(row).toBeNull()
  })
})
