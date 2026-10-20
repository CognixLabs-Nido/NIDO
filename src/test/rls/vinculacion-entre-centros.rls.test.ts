import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('next-intl/server', () => ({
  getTranslations:
    async ({ locale }: { locale: string }) =>
    (k: string) =>
      `${locale}:${k}`,
}))
// El aviso a una cuenta existente sale por Resend: aquí se captura en vez de mandarlo.
const correo = vi.hoisted(() => ({
  enviados: [] as Array<{ para: string; asunto: string; texto: string }>,
  falla: false,
}))
vi.mock('@/shared/lib/correo/enviar-correo', () => ({
  enviarCorreo: async (c: { para: string; asunto: string; texto: string }) => {
    if (correo.falla) return { enviado: false, motivo: 'fallo' }
    correo.enviados.push(c)
    return { enviado: true }
  },
}))

const { resolverTutorPorEmail } = await import('@/features/lista-espera/lib/resolver-tutor-email')
const { sendInvitation } = await import('@/features/auth/actions/send-invitation')
const { invitarAlAlta } = await import('@/features/lista-espera/actions/invitar-al-alta')
const { acceptPendingInvitationCore } = await import('@/features/auth/actions/accept-invitation')

/**
 * PR 1 (Fase 4) — entre centros no se vincula a nadie sin que acepte.
 *
 * Antes de 20261025120000 y de este PR (control positivo en el CI del commit bc1ebce), contra esta
 * misma BD efímera: la vista previa y `sendInvitation` le decían a la directora de A si un email
 * tenía cuenta en otro centro (D4); promover un prospecto con el email de un tutor de B le
 * vinculaba en A sin preguntarle y copiaba su nombre (hueco 1); aceptar desde el perfil no
 * enlazaba `familia_tutores` (hueco 2); y la directora pasaba cualquier `p_usuario_id` a
 * `crear_o_anadir_a_familia` o lo escribía en `lista_espera.tutor_usuario_id` (hueco 4).
 *
 * Ahora: la cuenta de otro centro se ve como familia nueva, se le invita (le llega el aviso, el
 * hueco 3) y entra cuando acepta, que es cuando se enlaza su perfil. La RPC y el trigger de
 * `lista_espera` rechazan la cuenta sin perfil en el centro. El 2.º hijo de una familia del centro
 * y la cuenta recién creada de «Completar en Dirección» siguen funcionando (controles).
 */

let centroA: TestCentro
let centroB: TestCentro
let aulaA: TestAula
let directoraA: TestUser
let tutorA: TestUser
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

/** Tutor con su familia, su rol y un hijo en `centroId`. */
async function tutorConFamiliaEn(u: TestUser, centroId: string): Promise<void> {
  await asignarRol(u.id, centroId, 'tutor_legal')
  const familia = await createTestFamilia(centroId)
  await crearFamiliaTutor(familia, u.id, 'titular')
  const { data: nino } = await serviceClient
    .from('ninos')
    .insert({
      centro_id: centroId,
      familia_id: familia,
      nombre: `Hijo-${randomUUID().slice(0, 8)}`,
      apellidos: 'Apellido Test',
      fecha_nacimiento: '2024-03-15',
    })
    .select('id')
    .single()
  await crearVinculo(nino!.id, u.id, 'tutor_legal_principal')
}

function rpcAlta(usuarioId: string | null, email: string) {
  return {
    p_nombre_nino: `Alta-${randomUUID().slice(0, 8)}`,
    p_apellidos_nino: 'Apellido Test',
    p_fecha_nacimiento: '2024-03-15',
    p_centro_id: centroA.id,
    p_aula_id: aulaA.id,
    p_tutor_email: email,
    p_tutor_nombre_completo: usuarioId ? 'Cualquiera' : '',
    p_parentesco: usuarioId ? 'madre' : '',
    p_descripcion_parentesco: '',
    p_usuario_id: usuarioId as unknown as string,
    p_permisos: {},
  }
}

beforeAll(async () => {
  centroA = await createTestCentro('Vinculación A')
  centroB = await createTestCentro('Vinculación B')
  const cursoA = await createTestCurso(centroA.id)
  aulaA = await createTestAula(centroA.id, cursoA.id)

  directoraA = await createTestUser({ nombre: 'Directora A' })
  await asignarRol(directoraA.id, centroA.id, 'admin')

  tutorA = await createTestUser({ nombre: 'Tutor A Vinculacion' })
  await tutorConFamiliaEn(tutorA, centroA.id)

  tutorB = await createTestUser({ nombre: 'Tutor B Vinculacion' })
  otraDeB = await createTestUser({ nombre: 'Otra B Vinculacion' })
  aceptaB = await createTestUser({ nombre: 'Acepta B Vinculacion' })
  for (const u of [tutorB, otraDeB, aceptaB]) await tutorConFamiliaEn(u, centroB.id)
}, 120_000)

afterAll(async () => {
  for (const u of [directoraA, tutorA, tutorB, otraDeB, aceptaB]) if (u) await deleteTestUser(u.id)
  await serviceClient.from('lista_espera').delete().eq('centro_id', centroA.id)
  await deleteTestCentro(centroA.id)
  await deleteTestCentro(centroB.id)
}, 120_000)

beforeEach(() => {
  correo.enviados = []
  correo.falla = false
})

describe('PR 1 — entre centros no se vincula a nadie sin que acepte', () => {
  it('premisa: los tutores de B no tienen nada en A; el tutor de A sí', async () => {
    for (const u of [tutorB, otraDeB, aceptaB]) {
      expect(await rolesEn(u.id, centroB.id)).toBe(1)
      expect(await rolesEn(u.id, centroA.id)).toBe(0)
    }
    expect(await rolesEn(tutorA.id, centroA.id)).toBe(1)
  })

  it('D4: la vista previa ve un email de otro centro igual que uno sin cuenta', async () => {
    const deB = await resolverTutorPorEmail(serviceClient, tutorB.email, centroA.id)
    const libre = await resolverTutorPorEmail(
      serviceClient,
      `libre-${randomUUID().slice(0, 8)}@nido.test`,
      centroA.id
    )
    expect(libre).toEqual({
      deteccion: 'familia_nueva',
      tutorUsuarioId: null,
      familiaEtiqueta: null,
    })
    expect(deB).toEqual(libre)
  })

  it('D4 + hueco 3: sendInvitation contesta lo mismo, y a la cuenta existente le llega el aviso', async () => {
    sesion.actual = await clientFor(directoraA)
    const existente = await sendInvitation({
      email: tutorB.email,
      rolObjetivo: 'admin',
      centroId: centroA.id,
    })
    const libre = await sendInvitation({
      email: `libre-${randomUUID().slice(0, 8)}@nido.test`,
      rolObjetivo: 'admin',
      centroId: centroA.id,
    })
    expect(existente.success).toBe(true)
    expect(libre.success).toBe(true)
    // El de la cuenta nueva lo manda GoTrue; el aviso por Resend solo va a la que existe.
    expect(correo.enviados.map((c) => c.para)).toEqual([tutorB.email])
    expect(correo.enviados[0]!.texto).toContain('/profile/invitations')
  })

  it('D4: si el aviso no sale, el error es el de cualquier correo que no sale', async () => {
    sesion.actual = await clientFor(directoraA)
    correo.falla = true
    const r = await sendInvitation({
      email: tutorB.email,
      rolObjetivo: 'admin',
      centroId: centroA.id,
    })
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.email_no_enviado' })
  })

  it('huecos 1 y 2: el tutor de B se invita, no se vincula, y entra al aceptar desde su perfil', async () => {
    sesion.actual = await clientFor(directoraA)
    const id = await prospectoEnA(tutorB.email)
    const r = await invitarAlAlta({ id, aulaId: aulaA.id })
    expect(r.success && r.data.resultado).toBe('ok')
    const ninoId = r.success && r.data.resultado === 'ok' ? r.data.ninoId : ''

    // Nada suyo en A todavía, ni su nombre.
    expect(await rolesEn(tutorB.id, centroA.id)).toBe(0)
    const { data: nino } = await serviceClient
      .from('ninos')
      .select('familia_id')
      .eq('id', ninoId)
      .single()
    const { data: perfiles } = await serviceClient
      .from('familia_tutores')
      .select('usuario_id, nombre_completo')
      .eq('familia_id', nino!.familia_id)
    expect(perfiles).toHaveLength(1)
    expect(perfiles![0]!.usuario_id).toBeNull()
    expect(perfiles![0]!.nombre_completo).not.toBe('Tutor B Vinculacion')
    expect(correo.enviados.map((c) => c.para)).toEqual([tutorB.email])

    // Acepta desde su perfil: rol, vínculo y su perfil de la familia enlazado.
    const { data: inv } = await serviceClient
      .from('invitaciones')
      .select('id')
      .eq('email', tutorB.email)
      .eq('nino_id', ninoId)
      .single()
    const acepta = await acceptPendingInvitationCore(
      { serviceClient, user: { id: tutorB.id, email: tutorB.email } },
      inv!.id,
      { parentesco: 'padre' }
    )
    expect(acepta).toEqual({ success: true, data: { rol: 'tutor_legal' } })
    expect(await rolesEn(tutorB.id, centroA.id)).toBe(1)
    const { data: enlazado } = await serviceClient
      .from('familia_tutores')
      .select('usuario_id, nombre_completo')
      .eq('familia_id', nino!.familia_id)
      .single()
    expect(enlazado).toEqual({ usuario_id: tutorB.id, nombre_completo: 'Tutor B Vinculacion' })
    const { count: vinculos } = await serviceClient
      .from('vinculos_familiares')
      .select('id', { count: 'exact', head: true })
      .eq('nino_id', ninoId)
      .eq('usuario_id', tutorB.id)
    expect(vinculos).toBe(1)
  })

  it('hueco 2: aceptar desde el perfil enlaza familia_tutores (alta creada por la RPC)', async () => {
    const c = await clientFor(directoraA)
    const { data: alta, error } = await c.rpc(
      'crear_o_anadir_a_familia',
      rpcAlta(null, aceptaB.email)
    )
    expect(error).toBeNull()
    const { nino_id: ninoId, familia_id: familiaId } = alta as {
      nino_id: string
      familia_id: string
    }
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
    expect(perfiles).toEqual([{ usuario_id: aceptaB.id }])
  })

  it('hueco 4: la RPC rechaza el id de una cuenta de B (42501) y no le da nada en A', async () => {
    const c = await clientFor(directoraA)
    const { error } = await c.rpc(
      'crear_o_anadir_a_familia',
      rpcAlta(otraDeB.id, `directo-${randomUUID().slice(0, 8)}@nido.test`)
    )
    expect(error?.code).toBe('42501')
    expect(await rolesEn(otraDeB.id, centroA.id)).toBe(0)
  })

  it('hueco 4: lista_espera.tutor_usuario_id no acepta una cuenta sin familia en el centro (23514)', async () => {
    const c = await clientFor(directoraA)
    const id = await prospectoEnA(null)
    const conSesion = await c
      .from('lista_espera')
      .update({ tutor_usuario_id: otraDeB.id })
      .eq('id', id)
    expect(conSesion.error?.code).toBe('23514')
    // La regla es de la fila, no de quien escribe.
    const conServicio = await serviceClient
      .from('lista_espera')
      .update({ tutor_usuario_id: otraDeB.id })
      .eq('id', id)
    expect(conServicio.error?.code).toBe('23514')
  })

  it('control: el 2.º hijo de una familia de A se vincula directamente, y su prospecto la guarda', async () => {
    sesion.actual = await clientFor(directoraA)
    const id = await prospectoEnA(tutorA.email)
    const { error: guarda } = await sesion.actual
      .from('lista_espera')
      .update({ tutor_usuario_id: tutorA.id })
      .eq('id', id)
    expect(guarda).toBeNull()
    const r = await invitarAlAlta({ id, aulaId: aulaA.id })
    expect(r.success && r.data.resultado).toBe('vinculado')
    expect(correo.enviados).toEqual([])
  })

  it('control: la RPC acepta la cuenta recién creada de «Completar en Dirección»', async () => {
    const email = `nueva-${randomUUID().slice(0, 8)}@nido.test`
    const { data: creada } = await serviceClient.auth.admin.createUser({
      email,
      password: `Pw-${randomUUID()}`,
      email_confirm: true,
    })
    const nuevaId = creada.user!.id
    try {
      const c = await clientFor(directoraA)
      const { data, error } = await c.rpc('crear_o_anadir_a_familia', rpcAlta(nuevaId, email))
      expect(error).toBeNull()
      expect((data as { resultado: string }).resultado).toBe('familia_creada')
      expect(await rolesEn(nuevaId, centroA.id)).toBe(1)
    } finally {
      await deleteTestUser(nuevaId)
    }
  })

  it('sin correo no se sigue en silencio: el alta queda creada y se dice, y no se duplica', async () => {
    sesion.actual = await clientFor(directoraA)
    const id = await prospectoEnA(otraDeB.email)
    correo.falla = true
    const r = await invitarAlAlta({ id, aulaId: aulaA.id })
    expect(r).toEqual({ success: false, error: 'listaEspera.errors.alta_creada_sin_correo' })
    const { data: prospecto } = await serviceClient
      .from('lista_espera')
      .select('estado, nino_id')
      .eq('id', id)
      .single()
    expect(prospecto?.estado).toBe('invitado')
    expect(prospecto?.nino_id).not.toBeNull()
    // Un segundo intento no crea otro niño.
    correo.falla = false
    const otra = await invitarAlAlta({ id, aulaId: aulaA.id })
    expect(otra).toEqual({ success: false, error: 'listaEspera.errors.no_en_espera' })
  })
})
