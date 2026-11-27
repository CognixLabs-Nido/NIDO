import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

import { clienteConFallos, type SesionConFallos } from './lectura-fallida'
import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestFamilia,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'

const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
// El servicio de la acción, con el fallo que se pida (la sesión real es el service role del CI).
const fallos = vi.hoisted(
  (): SesionConFallos => ({ actual: null, fallaTabla: null, fallaRpc: null, fallidas: 0 })
)
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => clienteConFallos(fallos),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], set: () => {}, get: () => undefined }),
}))
vi.mock('@/shared/lib/correo/enviar-correo', () => ({
  enviarCorreo: async () => ({ enviado: true }),
}))

const { sendInvitation } = await import('@/features/auth/actions/send-invitation')

/**
 * B2 (2026-11-27, Jose: «Mídelo antes, que lo tienes leído, y ciérralo con el criterio de siempre:
 * si no se pudo leer si ya había una invitación abierta, no se abre otra y se dice»).
 * `sendInvitation` busca primero una invitación abierta al mismo email, centro, rol y niño, y si la
 * hay la reutiliza (mismo token). Si esa lectura falla, ¿qué hace? Medido abierto. Fixtures ficticios.
 */
describe('la invitación no abre otra si no pudo leer si ya había una (medido abierto)', () => {
  let centro: TestCentro
  let directora: TestUser
  let nino: string
  const email = `dedupe-${Date.now()}@nido.test`

  async function abiertas() {
    const { data, error } = await serviceClient
      .from('invitaciones')
      .select('id, token, expires_at')
      .eq('email', email)
      .eq('nino_id', nino)
      .is('accepted_at', null)
      .is('rejected_at', null)
    expect(error).toBeNull()
    return data ?? []
  }

  const invitar = () =>
    sendInvitation({
      email,
      rolObjetivo: 'tutor_legal',
      centroId: centro.id,
      ninoId: nino,
      tipoVinculo: 'tutor_legal_secundario',
    })

  beforeAll(async () => {
    centro = await createTestCentro('Centro Dedupe Caida')
    directora = await createTestUser({ nombre: 'Directora Dedupe' })
    await asignarRol(directora.id, centro.id, 'directora')
    const familia = await createTestFamilia(centro.id)
    const { data: n, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        nombre: 'Dani',
        primer_apellido: 'Dedupe',
        familia_id: familia,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    nino = n!.id
    sesion.actual = await clientFor(directora)
    fallos.actual = serviceClient
  })

  afterAll(async () => {
    sesion.actual = null
    const { data } = await serviceClient.auth.admin.listUsers({ perPage: 1000 })
    for (const u of data?.users ?? [])
      if (u.email?.toLowerCase() === email) await serviceClient.auth.admin.deleteUser(u.id)
    if (centro) await deleteTestCentro(centro.id)
    if (directora) await deleteTestUser(directora.id)
  })

  it('control: sin fallo, la segunda invitación reutiliza la primera (una fila, el mismo token)', async () => {
    expect(await abiertas()).toHaveLength(0)
    expect((await invitar()).success).toBe(true)
    const tras1 = await abiertas()
    expect(tras1).toHaveLength(1)
    await new Promise((res) => setTimeout(res, 1_500)) // max_frequency del GoTrue del CI
    expect((await invitar()).success).toBe(true)
    const tras2 = await abiertas()
    expect(tras2).toHaveLength(1)
    expect(tras2[0]!.token).toBe(tras1[0]!.token)
  }, 60_000)

  it('con la lectura de la invitación abierta caída: no se abre otra y se dice', async () => {
    const antes = await abiertas()
    expect(antes).toHaveLength(1)
    await new Promise((res) => setTimeout(res, 1_500))
    fallos.fallaTabla = 'invitaciones'
    fallos.fallaSoloLaN = 1
    fallos.vistas = 0
    fallos.fallidas = 0
    const r = await invitar()
    fallos.fallaTabla = null
    fallos.fallaSoloLaN = null
    // Premisa: el fallo entró, y en la lectura de deduplicado (la primera de `invitaciones`).
    expect(fallos.fallidas).toBe(1)
    const despues = await abiertas()
    console.warn(
      'invitación con el deduplicado caído:',
      JSON.stringify({
        r,
        antes: antes.length,
        despues: despues.length,
        tokensDistintos: new Set(despues.map((i) => i.token)).size,
      })
    )
    expect(despues).toHaveLength(1)
    expect(despues[0]!.token).toBe(antes[0]!.token)
    expect(r).toEqual({ success: false, error: 'common.lectura_fallida' })
  }, 60_000)
})
