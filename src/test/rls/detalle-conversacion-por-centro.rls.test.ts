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
 * Multicentro — el detalle de una conversación abierta por URL (`/messages/conversacion/[id]`)
 * es solo el del centro activo.
 *
 * La RLS deja leer las conversaciones de TODOS los centros del usuario. Una directora de A y B y
 * una tutora con un hijo en cada uno abrían en A, por enlace o notificación, la conversación de
 * B, y la veían bajo el centro equivocado. Las dos consultas de detalle reciben ahora el centro
 * de la página: la de otro centro devuelve `null` y la página responde «no encontrado», como los
 * detalles de la Fase 1 y de la Fase 2. Cada caso empieza por su premisa: sin acotar, la RLS deja
 * leer las dos.
 */

const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))

const { getConversacionDetalle } =
  await import('@/features/messaging/queries/get-conversacion-detalle')
const { getAdminFamiliaDetalle } =
  await import('@/features/messaging/queries/get-admin-familia-detalle')
const { abrirConversacionAdminFamiliaCore } =
  await import('@/features/messaging/actions/abrir-conversacion-admin-familia')

describe('Multicentro — detalle de conversación por centro', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let directora: TestUser // admin en A y en B
  let tutora: TestUser // un hijo en A y otro en B
  let cDirectora: SupabaseClient<Database>
  let cTutora: SupabaseClient<Database>
  const conv: Record<'A' | 'B', string> = { A: '', B: '' } // profe↔familia
  const hilo: Record<'A' | 'B', string> = { A: '', B: '' } // dirección↔familia

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Detalle Conversacion A')
    centroB = await createTestCentro('Centro Detalle Conversacion B')
    directora = await createTestUser({ nombre: 'Directora Detalle A y B' })
    tutora = await createTestUser({ nombre: 'Tutora Detalle A y B' })
    cDirectora = await clientFor(directora)
    cTutora = await clientFor(tutora)
    for (const [k, c] of [
      ['A', centroA],
      ['B', centroB],
    ] as const) {
      await asignarRol(directora.id, c.id, 'admin')
      await asignarRol(tutora.id, c.id, 'tutor_legal')
      const nino = await createTestNino(c.id, `Hijo Detalle ${k}`)
      await crearVinculo(nino.id, tutora.id, 'tutor_legal_principal', {
        puede_recibir_mensajes: true,
      })
      const { data, error } = await serviceClient
        .from('conversaciones')
        .insert({ nino_id: nino.id, centro_id: c.id })
        .select('id')
        .single()
      if (error || !data) throw new Error(`conversación ${k}: ${error?.message}`)
      conv[k] = data.id
      const r = await abrirConversacionAdminFamiliaCore(cDirectora, directora.id, tutora.id, c.id)
      if (!r.success) throw new Error(`hilo ${k}: ${JSON.stringify(r)}`)
      hilo[k] = r.data.conversacion_id
    }
  }, 120_000)

  afterAll(async () => {
    sesion.actual = null
    const ids = [directora, tutora].map((u) => u?.id).filter((u): u is string => !!u)
    const convs = [conv.A, conv.B, hilo.A, hilo.B].filter(Boolean)
    await serviceClient.from('lectura_conversacion').delete().in('conversacion_id', convs)
    await serviceClient.from('mensajes').delete().in('conversacion_id', convs)
    await serviceClient.from('conversaciones').delete().in('id', convs)
    await serviceClient.from('vinculos_familiares').delete().in('usuario_id', ids)
    for (const c of [centroA, centroB]) if (c) await deleteTestCentro(c.id)
    for (const u of ids) await deleteTestUser(u)
  }, 120_000)

  it('premisa: sin acotar, la RLS deja leer a las dos las cuatro conversaciones', async () => {
    const todas = [conv.A, conv.B, hilo.A, hilo.B]
    expect(new Set(todas).size).toBe(4)
    for (const c of [cTutora, cDirectora]) {
      const { data } = await c.from('conversaciones').select('id').in('id', todas)
      expect((data ?? []).map((f) => f.id).sort()).toEqual([...todas].sort())
    }
  })

  it('profe↔familia: la de B no se abre en A; en B, sí', async () => {
    for (const c of [cTutora, cDirectora]) {
      sesion.actual = c
      expect(await getConversacionDetalle(conv.B, centroA.id)).toBeNull()
      expect((await getConversacionDetalle(conv.B, centroB.id))?.header.id).toBe(conv.B)
      expect((await getConversacionDetalle(conv.A, centroA.id))?.header.id).toBe(conv.A)
    }
  })

  it('dirección↔familia: el hilo de B no se abre en A; en B, sí', async () => {
    for (const c of [cTutora, cDirectora]) {
      sesion.actual = c
      expect(await getAdminFamiliaDetalle(hilo.B, centroA.id)).toBeNull()
      expect((await getAdminFamiliaDetalle(hilo.B, centroB.id))?.header.id).toBe(hilo.B)
      expect((await getAdminFamiliaDetalle(hilo.A, centroA.id))?.header.id).toBe(hilo.A)
    }
  })
})
