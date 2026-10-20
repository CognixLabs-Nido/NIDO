import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

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
  serviceClient,
  type TestAula,
  type TestCentro,
  type TestUser,
} from './setup'

// Las acciones corren fuera de una petición: la sesión de quien actúa la pone cada test.
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
vi.mock('@/features/push/lib/enviar-push', () => ({ enviarPushANotificarUsuarios: async () => {} }))

const { resolverTutorPorEmail } = await import('@/features/lista-espera/lib/resolver-tutor-email')
const { sendInvitation } = await import('@/features/auth/actions/send-invitation')
const { invitarAlAlta } = await import('@/features/lista-espera/actions/invitar-al-alta')
const { acceptPendingInvitationCore } = await import('@/features/auth/actions/accept-invitation')

/**
 * PR 1 (Fase 4) — entre centros no se vincula a nadie sin que acepte.
 *
 * CONTROL POSITIVO: cada test demuestra, contra la BD efímera, una puerta que hoy está abierta.
 *  - D4: la vista previa y `sendInvitation` dicen a la directora de A si un email tiene cuenta en
 *    otro centro.
 *  - Hueco 1: al promover un prospecto con el email de un tutor de B, se le vincula en A sin
 *    preguntarle, y su nombre se copia a A.
 *  - Hueco 2: aceptar desde el perfil no enlaza `familia_tutores.usuario_id`.
 *  - Hueco 4: la directora de A pasa a `crear_o_anadir_a_familia` cualquier `p_usuario_id`, o lo
 *    escribe en `lista_espera.tutor_usuario_id`.
 */

let centroA: TestCentro
let centroB: TestCentro
let aulaA: TestAula
let directoraA: TestUser
let tutorB: TestUser
let otraDeB: TestUser
let aceptaB: TestUser

async function prospectoEnA(email: string | null): Promise<string> {
  const { data, error } = await serviceClient
    .from('lista_espera')
    .insert({
      centro_id: centroA.id,
      curso_academico_id: aulaA.curso_academico_id,
      nombre_nino: `Prospecto-${randomUUID().slice(0, 8)}`,
      apellidos_nino: 'Apellido Test',
      fecha_nacimiento: '2024-03-15',
      email_tutor: email,
      posicion: Math.floor(Math.random() * 1_000_000),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`prospectoEnA falló: ${error?.message}`)
  return data.id
}

async function rolesEn(usuarioId: string, centroId: string): Promise<number> {
  const { count } = await serviceClient
    .from('roles_usuario')
    .select('id', { count: 'exact', head: true })
    .eq('usuario_id', usuarioId)
    .eq('centro_id', centroId)
    .is('deleted_at', null)
  return count ?? 0
}

/** Lo que crea la RPC al invitar (`p_usuario_id` NULL): familia, perfil sin cuenta, niño. */
async function altaInvitadaEnA(email: string): Promise<{ ninoId: string; familiaId: string }> {
  const c = await clientFor(directoraA)
  const { data, error } = await c.rpc('crear_o_anadir_a_familia', {
    p_nombre_nino: `Invitado-${randomUUID().slice(0, 8)}`,
    p_apellidos_nino: 'Apellido Test',
    p_fecha_nacimiento: '2024-03-15',
    p_centro_id: centroA.id,
    p_aula_id: aulaA.id,
    p_tutor_email: email,
    p_tutor_nombre_completo: '',
    p_parentesco: '',
    p_descripcion_parentesco: '',
    p_usuario_id: null as unknown as string,
    p_permisos: {},
  })
  if (error) throw new Error(`altaInvitadaEnA falló: ${error.message}`)
  const r = data as { nino_id: string; familia_id: string }
  return { ninoId: r.nino_id, familiaId: r.familia_id }
}

beforeAll(async () => {
  centroA = await createTestCentro('Vinculación A')
  centroB = await createTestCentro('Vinculación B')
  const cursoA = await createTestCurso(centroA.id)
  aulaA = await createTestAula(centroA.id, cursoA.id)

  directoraA = await createTestUser({ nombre: 'Directora A' })
  await asignarRol(directoraA.id, centroA.id, 'admin')

  // Tres tutores de B, con su familia y un hijo allí.
  tutorB = await createTestUser({ nombre: 'Tutor B Vinculacion' })
  otraDeB = await createTestUser({ nombre: 'Otra B Vinculacion' })
  aceptaB = await createTestUser({ nombre: 'Acepta B Vinculacion' })
  for (const u of [tutorB, otraDeB, aceptaB]) {
    await asignarRol(u.id, centroB.id, 'tutor_legal')
    const familia = await createTestFamilia(centroB.id)
    await crearFamiliaTutor(familia, u.id, 'titular')
    const { data: nino } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centroB.id,
        familia_id: familia,
        nombre: `HijoB-${randomUUID().slice(0, 8)}`,
        apellidos: 'Apellido Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    await crearVinculo(nino!.id, u.id, 'tutor_legal_principal')
  }
}, 120_000)

afterAll(async () => {
  for (const u of [directoraA, tutorB, otraDeB, aceptaB]) if (u) await deleteTestUser(u.id)
  await serviceClient.from('lista_espera').delete().eq('centro_id', centroA.id)
  await deleteTestCentro(centroA.id)
  await deleteTestCentro(centroB.id)
}, 120_000)

describe('PR 1 — control positivo: hoy se vincula entre centros sin aceptar', () => {
  it('premisa: los tutores de B no tienen nada en A', async () => {
    for (const u of [tutorB, otraDeB, aceptaB]) {
      expect(await rolesEn(u.id, centroB.id)).toBe(1)
      expect(await rolesEn(u.id, centroA.id)).toBe(0)
    }
  })

  it('D4: la vista previa distingue un email de otro centro de uno sin cuenta', async () => {
    const deB = await resolverTutorPorEmail(serviceClient, tutorB.email, centroA.id)
    const libre = await resolverTutorPorEmail(
      serviceClient,
      `libre-${randomUUID().slice(0, 8)}@nido.test`,
      centroA.id
    )
    expect(libre?.deteccion).toBe('familia_nueva')
    expect(deB?.deteccion).toBe('cuenta_sin_familia_aqui')
  })

  it('D4: sendInvitation le dice a la directora que el email ya tiene cuenta', async () => {
    sesion.actual = await clientFor(directoraA)
    const r = await sendInvitation({
      email: tutorB.email,
      rolObjetivo: 'profe',
      centroId: centroA.id,
    })
    expect(r).toEqual({ success: false, error: 'listaEspera.errors.tutor_ya_registrado' })
  })

  it('hueco 1: promover un prospecto con el email de B le vincula en A y copia su nombre', async () => {
    sesion.actual = await clientFor(directoraA)
    const id = await prospectoEnA(tutorB.email)
    const r = await invitarAlAlta({ id, aulaId: aulaA.id })
    expect(r.success && r.data.resultado).toBe('vinculado')
    expect(await rolesEn(tutorB.id, centroA.id)).toBe(1)
    const { data: perfil } = await serviceClient
      .from('familia_tutores')
      .select('nombre_completo, familias!inner(centro_id)')
      .eq('usuario_id', tutorB.id)
      .eq('familias.centro_id', centroA.id)
      .maybeSingle()
    expect(perfil?.nombre_completo).toBe('Tutor B Vinculacion')
  })

  it('hueco 4: la directora de A pasa a la RPC el id de una cuenta de B', async () => {
    const c = await clientFor(directoraA)
    const { data, error } = await c.rpc('crear_o_anadir_a_familia', {
      p_nombre_nino: `Directo-${randomUUID().slice(0, 8)}`,
      p_apellidos_nino: 'Apellido Test',
      p_fecha_nacimiento: '2024-03-15',
      p_centro_id: centroA.id,
      p_aula_id: aulaA.id,
      p_tutor_email: '',
      p_tutor_nombre_completo: 'Cualquiera',
      p_parentesco: 'madre',
      p_descripcion_parentesco: '',
      p_usuario_id: otraDeB.id,
      p_permisos: {},
    })
    expect(error).toBeNull()
    expect((data as { resultado: string }).resultado).toBe('familia_creada')
    expect(await rolesEn(otraDeB.id, centroA.id)).toBe(1)
  })

  it('hueco 4: la directora de A escribe en lista_espera.tutor_usuario_id el id de B', async () => {
    const c = await clientFor(directoraA)
    const id = await prospectoEnA(null)
    const { error } = await c
      .from('lista_espera')
      .update({ tutor_usuario_id: otraDeB.id })
      .eq('id', id)
    expect(error).toBeNull()
    const { data } = await serviceClient
      .from('lista_espera')
      .select('tutor_usuario_id')
      .eq('id', id)
      .single()
    expect(data?.tutor_usuario_id).toBe(otraDeB.id)
  })

  it('hueco 2: aceptar desde el perfil no enlaza familia_tutores', async () => {
    const { ninoId, familiaId } = await altaInvitadaEnA(aceptaB.email)
    const { data: inv } = await serviceClient
      .from('invitaciones')
      .insert({
        email: aceptaB.email,
        rol_objetivo: 'tutor_legal',
        centro_id: centroA.id,
        nino_id: ninoId,
        tipo_vinculo: 'tutor_legal_principal',
        invitado_por: directoraA.id,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select('id')
      .single()
    const r = await acceptPendingInvitationCore(
      { serviceClient, user: { id: aceptaB.id, email: aceptaB.email } },
      inv!.id,
      { parentesco: 'madre' }
    )
    expect(r.success).toBe(true)
    const { data: perfiles } = await serviceClient
      .from('familia_tutores')
      .select('usuario_id')
      .eq('familia_id', familiaId)
    expect(perfiles).toEqual([{ usuario_id: null }])
  })
})
