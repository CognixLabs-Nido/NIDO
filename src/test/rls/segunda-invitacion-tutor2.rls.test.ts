import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'

const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], set: () => {}, get: () => undefined }),
}))
// El aviso por Resend («acepta desde tu perfil») sale por aquí: se CUENTA, para distinguir qué
// correo mandó la segunda invitación.
const avisos = vi.hoisted(() => ({ n: 0 }))
vi.mock('@/shared/lib/correo/enviar-correo', () => ({
  enviarCorreo: async () => {
    avisos.n++
    return { enviado: true }
  },
}))

// El GoTrue del CI solo acepta `127.0.0.1:3000` como destino (config.toml): con el `localhost` por
// defecto de `getAppUrl` cambia el enlace por su `site_url` pelado y el correo no lleva el token
// (medido, run 45977463781). Se fija el de la lista para que el enlace del correo se pueda leer.
vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://127.0.0.1:3000')

const { invitarTutor2 } = await import('@/features/matriculas/lib/invitacion-tutor2')

const BUZON = process.env.MAILPIT_URL ?? process.env.INBUCKET_URL

/** Los enlaces (`href`) de los correos que ha recibido ese email, del más viejo al más nuevo. */
async function enlacesDelBuzon(para: string): Promise<string[]> {
  const r = await fetch(`${BUZON}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`)
  expect(r.ok).toBe(true)
  const lista = ((await r.json()) as { messages?: Array<{ ID: string }> }).messages ?? []
  const hrefs: string[] = []
  for (const m of [...lista].reverse()) {
    const c = (await (await fetch(`${BUZON}/api/v1/message/${m.ID}`)).json()) as {
      HTML?: string
      Text?: string
    }
    // Todos los href del correo, unidos: el instrumento no presupone la forma del enlace.
    const todos = [...(c.HTML ?? '').matchAll(/href=["']([^"']*)["']/g)].map((x) => x[1])
    const urlsTexto = (c.Text ?? '').match(/https?:\/\/\S+/g) ?? []
    hrefs.push(
      todos.length
        ? todos.join(' | ')
        : urlsTexto.length
          ? `texto: ${urlsTexto.join(' | ')}`
          : `(sin enlace; html ${(c.HTML ?? '').length} car., texto ${(c.Text ?? '').length})`
    )
  }
  return hrefs
}

async function esperarCorreos(para: string, n: number): Promise<string[]> {
  const fin = Date.now() + 15_000
  let hrefs: string[] = []
  while (Date.now() < fin) {
    hrefs = await enlacesDelBuzon(para)
    if (hrefs.length >= n) return hrefs
    await new Promise((res) => setTimeout(res, 500))
  }
  return hrefs
}

/**
 * B2 (2026-11-27, Jose: «Mide antes lo que haces con la segunda invitación sobre una pendiente»).
 * Con el email de antes guardado en la fila al reclamarla, un reintento de la cola puede invitar
 * otra vez a un segundo tutor que ya tiene una invitación abierta. Lo que se mide: si esa segunda
 * invitación invalida la primera o rompe algo. Por el camino de la cola (`invitarTutor2`), contra el
 * GoTrue y el buzón del CI. Fixtures ficticios.
 */
describe('la segunda invitación al segundo tutor, con una pendiente (medido antes de construir)', () => {
  let centro: TestCentro
  let directora: TestUser
  let tutor1: TestUser
  let nino: string
  const email = `t2-segunda-${Date.now()}@nido.test`

  async function invitacion() {
    const { data, error } = await serviceClient
      .from('invitaciones')
      .select('id, token, expires_at, accepted_at, rejected_at')
      .eq('nino_id', nino)
      .eq('tipo_vinculo', 'tutor_legal_secundario')
    expect(error).toBeNull()
    return data ?? []
  }

  async function cuentas() {
    const { data, error } = await serviceClient.auth.admin.listUsers({ perPage: 1000 })
    expect(error).toBeNull()
    return (data?.users ?? []).filter((u) => u.email?.toLowerCase() === email)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Segunda Invitacion')
    const curso = (await createTestCurso(centro.id)).id
    const aula = (await createTestAula(centro.id, curso, 'Patitos Segunda', [2025])).id
    directora = await createTestUser({ nombre: 'Directora Segunda' })
    tutor1 = await createTestUser({ nombre: 'Tutor Uno Segunda' })
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(tutor1.id, centro.id, 'tutor_legal')
    const familia = await createTestFamilia(centro.id)
    await crearFamiliaTutor(familia, tutor1.id, 'titular')
    const { data: n, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        nombre: 'Nuria',
        primer_apellido: 'Segunda',
        familia_id: familia,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    nino = n!.id
    await crearVinculo(nino, tutor1.id, 'tutor_legal_principal')
    const mat = await matricular(nino, aula, curso)
    expect(
      (
        await serviceClient
          .from('matriculas')
          .update({ estado: 'activa', activada_at: new Date().toISOString() })
          .eq('id', mat)
      ).error
    ).toBeNull()
    expect(
      (
        await serviceClient.from('familia_tutores').insert({
          familia_id: familia,
          rol_familia: 'segundo_tutor',
          email,
          nombre_completo: 'Segundo Tutor Segunda',
        })
      ).error
    ).toBeNull()
  })

  afterAll(async () => {
    sesion.actual = null
    for (const u of await cuentas()) await serviceClient.auth.admin.deleteUser(u.id)
    if (centro) await deleteTestCentro(centro.id)
    for (const u of [directora, tutor1]) if (u) await deleteTestUser(u.id)
  })

  it('dos invitaciones seguidas: qué fila, qué token, qué correo y qué cuenta quedan', async () => {
    expect(BUZON, 'el buzón del CI').toBeTruthy()
    sesion.actual = await clientFor(directora)
    // Premisa: no hay invitación ni cuenta de ese email antes de empezar.
    expect(await invitacion()).toHaveLength(0)
    expect(await cuentas()).toHaveLength(0)

    const r1 = await invitarTutor2(serviceClient, nino, directora.id, centro.id)
    const inv1 = await invitacion()
    const hrefs1 = await esperarCorreos(email, 1)
    const avisos1 = avisos.n
    const cuentas1 = (await cuentas()).map((u) => u.id)

    // max_frequency del CI es 1 s: la segunda no puede caer en el límite de envíos.
    await new Promise((res) => setTimeout(res, 1_500))
    const r2 = await invitarTutor2(serviceClient, nino, directora.id, centro.id)
    const inv2 = await invitacion()
    const hrefs2 = await esperarCorreos(email, 2)
    const avisos2 = avisos.n
    const cuentas2 = (await cuentas()).map((u) => u.id)

    const medido = {
      r1,
      r2,
      filas1: inv1.length,
      filas2: inv2.length,
      mismaFila: inv1[0]?.id === inv2[0]?.id,
      mismoToken: inv1[0]?.token === inv2[0]?.token,
      caducidadNoBaja: Date.parse(inv2[0]!.expires_at) >= Date.parse(inv1[0]!.expires_at),
      abierta: !inv2[0]?.accepted_at && !inv2[0]?.rejected_at,
      correos1: hrefs1.length,
      correos2: hrefs2.length,
      enlacePrimeroLlevaToken: hrefs2[0]?.includes(`/invitation/${inv2[0]?.token}`) ?? false,
      enlaceSegundoLlevaToken: hrefs2[1]?.includes(`/invitation/${inv2[0]?.token}`) ?? false,
      avisos1,
      avisos2,
      cuentas1: cuentas1.length,
      cuentas2: cuentas2.length,
      mismaCuenta: cuentas1[0] === cuentas2[0],
      // El instrumento a la vista: los dos enlaces, con el token de la fila cambiado por <TOKEN>
      // (si el regex no casa, sale «(sin enlace)»).
      enlaces: hrefs2.map((h) => h.split(inv2[0]?.token ?? '\u0000').join('<TOKEN>')),
      mismoEnlace: hrefs2.length === 2 && hrefs2[0] === hrefs2[1],
    }
    console.warn('segunda invitación:', JSON.stringify(medido))

    expect(r1).toEqual({ ok: true, email })
    expect(r2).toEqual({ ok: true, email })
    expect(medido).toMatchObject({
      filas1: 1,
      filas2: 1,
      mismaFila: true,
      mismoToken: true,
      caducidadNoBaja: true,
      abierta: true,
      correos1: 1,
      correos2: 2,
      enlacePrimeroLlevaToken: true,
      enlaceSegundoLlevaToken: true,
      avisos1: 0,
      avisos2: 0,
      cuentas1: 1,
      cuentas2: 1,
      mismaCuenta: true,
      mismoEnlace: true,
    })
  }, 60_000)
})
