import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Multicentro · Fase 2 · PR B — el hilo dirección↔familia es por centro (`20261022120000`).
 *
 * Una directora de A y B y una tutora con un hijo en cada uno. Antes había un hilo por par
 * (admin, tutor): el de A y el de B eran el mismo. Ahora hay uno por centro, y la lista de la
 * tutora, el badge de la directora y la lista de tutores de la pestaña Dirección enseñan el del
 * centro de la página. Cada caso empieza por su premisa: sin acotar, la RLS deja ver los dos.
 */

const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))

const { abrirConversacionAdminFamiliaCore } =
  await import('@/features/messaging/actions/abrir-conversacion-admin-familia')
const { getAdminFamiliaList } = await import('@/features/messaging/queries/get-admin-familia-list')
const { countNoLeidos } = await import('@/features/messaging/queries/count-no-leidos')
const { getTutoresParaAdminDireccionCore } =
  await import('@/features/messaging/queries/get-tutores-para-admin-direccion')

describe('Multicentro — hilo dirección↔familia por centro', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let directora: TestUser // admin en A y en B
  let adminA: TestUser // admin solo en A
  let tutora: TestUser // un hijo en A y otro en B
  let cDirectora: SupabaseClient<Database>
  let cTutora: SupabaseClient<Database>
  let hiloA: string
  let hiloB: string

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Hilo Direccion A')
    centroB = await createTestCentro('Centro Hilo Direccion B')
    directora = await createTestUser({ nombre: 'Directora Hilo A y B' })
    adminA = await createTestUser({ nombre: 'Admin Hilo Solo A' })
    tutora = await createTestUser({ nombre: 'Tutora Hilo A y B' })
    await asignarRol(directora.id, centroA.id, 'admin')
    await asignarRol(directora.id, centroB.id, 'admin')
    await asignarRol(adminA.id, centroA.id, 'admin')
    for (const c of [centroA, centroB]) {
      await asignarRol(tutora.id, c.id, 'tutor_legal')
      const nino = await createTestNino(c.id, 'Hijo Hilo Direccion')
      await crearVinculo(nino.id, tutora.id, 'tutor_legal_principal', {
        puede_recibir_mensajes: true,
      })
    }
    cDirectora = await clientFor(directora)
    cTutora = await clientFor(tutora)
  }, 120_000)

  afterAll(async () => {
    sesion.actual = null
    const ids = [directora, adminA, tutora].map((u) => u?.id).filter((u): u is string => !!u)
    await serviceClient.from('lectura_conversacion').delete().in('usuario_id', ids)
    await serviceClient.from('mensajes').delete().in('autor_id', ids)
    await serviceClient.from('conversaciones').delete().in('admin_id', ids)
    await serviceClient.from('vinculos_familiares').delete().in('usuario_id', ids)
    for (const c of [centroA, centroB]) if (c) await deleteTestCentro(c.id)
    for (const u of ids) await deleteTestUser(u)
  }, 120_000)

  it('abrir en A y en B da dos hilos; reabrir en A da el de A', async () => {
    const a = await abrirConversacionAdminFamiliaCore(
      cDirectora,
      directora.id,
      tutora.id,
      centroA.id
    )
    const b = await abrirConversacionAdminFamiliaCore(
      cDirectora,
      directora.id,
      tutora.id,
      centroB.id
    )
    if (!a.success || !b.success) throw new Error(`abrir: ${JSON.stringify({ a, b })}`)
    hiloA = a.data.conversacion_id
    hiloB = b.data.conversacion_id
    expect(hiloA).not.toBe(hiloB)
    const { data: filas } = await serviceClient
      .from('conversaciones')
      .select('id, centro_id')
      .in('id', [hiloA, hiloB])
    expect(new Map((filas ?? []).map((f) => [f.id, f.centro_id]))).toEqual(
      new Map([
        [hiloA, centroA.id],
        [hiloB, centroB.id],
      ])
    )
    const otraVez = await abrirConversacionAdminFamiliaCore(
      cDirectora,
      directora.id,
      tutora.id,
      centroA.id
    )
    expect(otraVez.success && otraVez.data.conversacion_id).toBe(hiloA)
  })

  it('solo abre la dirección de ese centro', async () => {
    const ajeno = await abrirConversacionAdminFamiliaCore(
      await clientFor(adminA),
      adminA.id,
      tutora.id,
      centroB.id
    )
    expect(ajeno).toEqual({ success: false, error: 'messages.errors.solo_admin' })
  })

  it('lista de la tutora: el hilo del centro de la página', async () => {
    // Premisa: la RLS le deja ver los dos.
    const { data: todos } = await cTutora
      .from('conversaciones')
      .select('id')
      .eq('tipo_conversacion', 'admin_familia')
    expect((todos ?? []).map((c) => c.id).sort()).toEqual([hiloA, hiloB].sort())
    sesion.actual = cTutora
    expect((await getAdminFamiliaList('tutor_legal', centroA.id)).map((h) => h.id)).toEqual([hiloA])
    expect((await getAdminFamiliaList('tutor_legal', centroB.id)).map((h) => h.id)).toEqual([hiloB])
  })

  it('badge de la directora: los no leídos del hilo de cada centro', async () => {
    for (const hilo of [hiloA, hiloB]) {
      const { error } = await serviceClient
        .from('mensajes')
        .insert({ conversacion_id: hilo, autor_id: tutora.id, contenido: 'Hola, dirección' })
      expect(error).toBeNull()
    }
    sesion.actual = cDirectora
    expect((await countNoLeidos(centroA.id)).conversaciones).toBe(1)
    expect((await countNoLeidos(centroB.id)).conversaciones).toBe(1)
  })

  it('pestaña Dirección: cada tutor con el hilo de este centro', async () => {
    const enA = await getTutoresParaAdminDireccionCore(cDirectora, directora.id, centroA.id)
    const enB = await getTutoresParaAdminDireccionCore(cDirectora, directora.id, centroB.id)
    expect(enA.find((t) => t.usuario_id === tutora.id)?.conversacion_id).toBe(hiloA)
    expect(enB.find((t) => t.usuario_id === tutora.id)?.conversacion_id).toBe(hiloB)
  })
})
