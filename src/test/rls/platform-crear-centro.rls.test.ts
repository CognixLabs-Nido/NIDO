import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import {
  anonClient,
  asignarRol,
  clientFor,
  createTestCentro,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
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
vi.mock('@/shared/lib/correo/enviar-correo', () => ({
  enviarCorreo: async () => ({ enviado: true }),
}))
// El correo de la invitación tiene sus tests; aquí se anota a quién iría.
const correos = vi.hoisted(() => ({ enviados: [] as Array<Record<string, unknown>> }))
vi.mock('@/features/auth/lib/correo-invitacion', () => ({
  enviarCorreoInvitacion: async (_s: unknown, datos: Record<string, unknown>) => {
    correos.enviados.push(datos)
    return null
  },
}))

const { crearCentro } = await import('@/features/plataforma/actions/crear-centro')
const { invitarAdmin } = await import('@/features/plataforma/actions/invitar-admin')
const { updateCentro } = await import('@/features/centros/actions/update-centro')
const { acceptPendingInvitationCore } = await import('@/features/auth/actions/accept-invitation')

/**
 * Fase 5, PR 2 — crear un centro desde la plataforma e invitar a su admin (20261104120000).
 *
 *  - `platform_crear_centro`: centro, curso activo e invitación de admin en una transacción, sin
 *    nada más (ni aulas, ni reglas). Nombres únicos entre los vivos, sin distinguir mayúsculas ni
 *    espacios, también al renombrar. Si falla algo, no queda nada.
 *  - `platform_invitar_admin`: solo sin admin viva; sin email reenvía la última, con email crea
 *    otra y caduca la anterior.
 *  - Las dos, solo la plataforma: ni la admin, ni una directora, ni una profe, ni anon.
 *  - Aceptar la invitación da el rol de admin; si el centro consiguió admin entre medias, el 23505
 *    del índice llega con su mensaje propio y la persona no entra como admin.
 */

type Cliente = SupabaseClient<Database>
const DIA = 86_400_000
const sufijo = () => Math.random().toString(36).slice(2, 8)

describe('platform_crear_centro y platform_invitar_admin', () => {
  const usuarios: TestUser[] = []
  const centros: string[] = []
  let superU: TestUser
  let adminA: TestUser
  let directoraA: TestUser
  let profeA: TestUser
  let A: { id: string; nombre: string }
  let cSuper: Cliente
  let nuevo: { id: string; nombre: string }

  async function usuario(nombre: string) {
    const u = await createTestUser({ nombre })
    usuarios.push(u)
    return u
  }
  async function contarCentros() {
    const { count, error } = await serviceClient
      .from('centros')
      .select('id', { count: 'exact', head: true })
    if (error) throw new Error(error.message)
    return count ?? 0
  }
  async function invitacionesAdmin(centroId: string) {
    const { data, error } = await serviceClient
      .from('invitaciones')
      .select('id, email, expires_at, invitado_por, accepted_at')
      .eq('centro_id', centroId)
      .eq('rol_objetivo', 'admin')
      .order('created_at')
    if (error) throw new Error(error.message)
    return data ?? []
  }
  async function metricasDe(centroId: string) {
    const { data, error } = await cSuper.rpc('platform_metricas')
    if (error) throw new Error(error.message)
    return (data ?? []).find((f) => f.centro_id === centroId)
  }
  function datosCentro(nombre: string, emailAdmin: string) {
    return {
      nombre,
      direccion: 'Calle Demo 1',
      telefono: '600000000',
      email_contacto: 'Contacto@Example.test',
      idioma_default: 'va' as const,
      curso_nombre: '2026-27',
      curso_inicio: '2026-09-01',
      curso_fin: '2027-07-31',
      email_admin: emailAdmin,
    }
  }

  beforeAll(async () => {
    superU = await usuario('Superusuario Crear Centro')
    const { error } = await serviceClient.from('platform_admins').insert({ usuario_id: superU.id })
    if (error) throw new Error(`sembrar superusuario falló: ${error.message}`)
    A = await createTestCentro(`Centro Crear A ${sufijo()}`)
    centros.push(A.id)
    adminA = await usuario('Admin Crear A')
    directoraA = await usuario('Directora Crear A')
    profeA = await usuario('Profe Crear A')
    await asignarRol(adminA.id, A.id, 'admin')
    await asignarRol(directoraA.id, A.id, 'directora')
    await asignarRol(profeA.id, A.id, 'profe')
    cSuper = await clientFor(superU)
  })

  afterAll(async () => {
    sesion.actual = null
    for (const c of centros) await deleteTestCentro(c)
    for (const u of usuarios) await deleteTestUser(u.id)
  })

  it('premisa: el superusuario lo es y la admin del centro no', async () => {
    expect((await cSuper.rpc('is_superadmin')).data).toBe(true)
    expect((await (await clientFor(adminA)).rpc('is_superadmin')).data).toBe(false)
  })

  it('crear: centro, curso activo e invitación de admin; nada más', async () => {
    sesion.actual = cSuper
    correos.enviados.length = 0
    const nombre = `  Centro Nuevo Plataforma ${sufijo()}  `
    const r = await crearCentro(datosCentro(nombre, 'Admin.Nuevo@Example.test'))
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.errorCorreo).toBeNull()
    nuevo = { id: r.data.centroId, nombre: nombre.trim() }
    centros.push(nuevo.id)

    const { data: c } = await serviceClient
      .from('centros')
      .select('nombre, email_contacto, idioma_default, logo_url, identificador_acreedor')
      .eq('id', nuevo.id)
      .single()
    expect(c).toEqual({
      nombre: nombre.trim(),
      email_contacto: 'contacto@example.test',
      idioma_default: 'va',
      logo_url: null,
      identificador_acreedor: null,
    })
    const { data: cursos } = await serviceClient
      .from('cursos_academicos')
      .select('nombre, fecha_inicio, fecha_fin, estado')
      .eq('centro_id', nuevo.id)
    expect(cursos).toEqual([
      { nombre: '2026-27', fecha_inicio: '2026-09-01', fecha_fin: '2027-07-31', estado: 'activo' },
    ])
    // Sin reglas de arranque: ni aulas, ni roles, ni autorizaciones, ni conceptos de cobro.
    for (const tabla of ['aulas', 'roles_usuario', 'autorizaciones', 'conceptos_cobro'] as const) {
      const { count } = await serviceClient
        .from(tabla)
        .select('id', { count: 'exact', head: true })
        .eq('centro_id', nuevo.id)
      expect(count, tabla).toBe(0)
    }

    const inv = await invitacionesAdmin(nuevo.id)
    expect(inv).toHaveLength(1)
    expect(inv[0]).toMatchObject({ email: 'admin.nuevo@example.test', invitado_por: superU.id })
    expect(new Date(inv[0]!.expires_at).getTime()).toBeGreaterThan(Date.now() + 6 * DIA)
    expect(correos.enviados).toEqual([
      {
        invitationId: inv[0]!.id,
        email: 'admin.nuevo@example.test',
        rolObjetivo: 'admin',
        centroId: nuevo.id,
        idioma: 'va',
      },
    ])
    expect(await metricasDe(nuevo.id)).toMatchObject({
      sin_admin: true,
      sin_curso_activo: false,
      curso_activo: '2026-27',
      invitacion_admin: 'pendiente',
    })
    // El actor de la auditoría es el superusuario.
    const { data: audit } = await serviceClient
      .from('audit_log')
      .select('tabla, usuario_id')
      .in('registro_id', [nuevo.id, inv[0]!.id])
    expect(new Set((audit ?? []).map((a) => `${a.tabla}:${a.usuario_id}`))).toEqual(
      new Set([`centros:${superU.id}`, `invitaciones:${superU.id}`])
    )
  })

  it('nombre repetido, sin distinguir mayúsculas ni espacios: no se crea nada', async () => {
    sesion.actual = cSuper
    const antes = await contarCentros()
    for (const nombre of [
      `  ${nuevo.nombre.toUpperCase()} `,
      nuevo.nombre.replace(/ /g, '   '),
      A.nombre.toLowerCase(),
    ]) {
      const r = await crearCentro(datosCentro(nombre, 'otra@example.test'))
      expect(r, nombre).toEqual({ success: false, error: 'plataforma.errores.nombre_duplicado' })
    }
    expect(await contarCentros()).toBe(antes)
  })

  it('renombrar un centro al nombre de otro vivo: lo para el índice', async () => {
    sesion.actual = await clientFor(adminA)
    const r = await updateCentro(A.id, {
      nombre: ` ${nuevo.nombre.toLowerCase()}`,
      direccion: 'Calle Falsa 123',
      telefono: '+34 000 000 000',
      email_contacto: 'a@nido.test',
      web: null,
      idioma_default: 'es',
    })
    expect(r).toEqual({ success: false, error: 'centro.errors.nombre_duplicado' })
  })

  it('si falla la invitación, no queda ni el centro ni el curso', async () => {
    const antes = await contarCentros()
    const nombre = `Centro Sin Admin ${sufijo()}`
    const { error } = await cSuper.rpc('platform_crear_centro', {
      p_nombre: nombre,
      p_direccion: 'Calle Demo 1',
      p_telefono: '600000000',
      p_email_contacto: 'a@example.test',
      p_idioma: 'es',
      p_curso_nombre: '2026-27',
      p_curso_inicio: '2026-09-01',
      p_curso_fin: '2027-07-31',
      p_email_admin: 'no-es-un-email',
    })
    expect(error).toMatchObject({ code: '22023', hint: 'email_admin' })
    expect(await contarCentros()).toBe(antes)
    const { count } = await serviceClient
      .from('centros')
      .select('id', { count: 'exact', head: true })
      .eq('nombre', nombre)
    expect(count).toBe(0)
  })

  it('invitar con admin viva: 55000, y no se escribe ninguna invitación', async () => {
    sesion.actual = cSuper
    const r = await invitarAdmin({ centroId: A.id, email: 'otra@example.test' })
    expect(r).toEqual({ success: false, error: 'plataforma.errores.centro_con_admin' })
    expect(await invitacionesAdmin(A.id)).toEqual([])
  })

  it('reenviar: la misma invitación con otros 7 días; otro email: nueva, y la anterior caduca', async () => {
    sesion.actual = cSuper
    const [primera] = await invitacionesAdmin(nuevo.id)
    await serviceClient
      .from('invitaciones')
      .update({ expires_at: new Date(Date.now() - DIA).toISOString() })
      .eq('id', primera!.id)
    expect((await metricasDe(nuevo.id))?.invitacion_admin).toBe('caducada')

    const reenvio = await invitarAdmin({ centroId: nuevo.id })
    expect(reenvio).toEqual({ success: true, data: { invitationId: primera!.id } })
    const [tras] = await invitacionesAdmin(nuevo.id)
    expect(new Date(tras!.expires_at).getTime()).toBeGreaterThan(Date.now() + 6 * DIA)
    expect((await metricasDe(nuevo.id))?.invitacion_admin).toBe('pendiente')

    const otra = await invitarAdmin({ centroId: nuevo.id, email: 'Segunda@Example.test' })
    expect(otra.success).toBe(true)
    const todas = await invitacionesAdmin(nuevo.id)
    expect(todas).toHaveLength(2)
    expect(todas[1]).toMatchObject({ email: 'segunda@example.test' })
    expect(new Date(todas[0]!.expires_at).getTime()).toBeLessThanOrEqual(Date.now())
    expect((await metricasDe(nuevo.id))?.invitacion_admin).toBe('pendiente')
  })

  it('solo la plataforma: la admin, una directora, una profe y anon reciben 42501', async () => {
    const args = {
      p_nombre: `Centro Intruso ${sufijo()}`,
      p_direccion: 'Calle Demo 1',
      p_telefono: '600000000',
      p_email_contacto: 'a@example.test',
      p_idioma: 'es',
      p_curso_nombre: '2026-27',
      p_curso_inicio: '2026-09-01',
      p_curso_fin: '2027-07-31',
      p_email_admin: 'x@example.test',
    }
    const antes = await contarCentros()
    for (const [quien, c] of [
      ['admin', await clientFor(adminA)],
      ['directora', await clientFor(directoraA)],
      ['profe', await clientFor(profeA)],
      ['anon', anonClient()],
    ] as const) {
      const crea = await c.rpc('platform_crear_centro', args)
      expect(crea.error?.code, `${quien} crear`).toBe('42501')
      const invita = await c.rpc('platform_invitar_admin', {
        p_centro_id: nuevo.id,
        p_email: 'x@example.test',
      })
      expect(invita.error?.code, `${quien} invitar`).toBe('42501')
    }
    expect(await contarCentros()).toBe(antes)
    // Y por la acción, con la sesión de la admin del centro.
    sesion.actual = await clientFor(adminA)
    expect(await crearCentro(datosCentro(args.p_nombre, 'x@example.test'))).toEqual({
      success: false,
      error: 'plataforma.errores.no_autorizado',
    })
  })

  it('aceptar: da el rol de admin; si el centro consiguió admin entre medias, su mensaje', async () => {
    sesion.actual = cSuper
    // Control positivo: un centro sin admin y una cuenta que acepta su invitación.
    const conAdmin = await crearCentro(
      datosCentro(`Centro Acepta ${sufijo()}`, 'pendiente@example.test')
    )
    expect(conAdmin.success).toBe(true)
    if (!conAdmin.success) return
    centros.push(conAdmin.data.centroId)
    const acepta = await usuario('Admin Acepta')
    const { data: invId, error: errInv } = await cSuper.rpc('platform_invitar_admin', {
      p_centro_id: conAdmin.data.centroId,
      p_email: acepta.email,
    })
    expect(errInv).toBeNull()
    expect(
      await acceptPendingInvitationCore(
        { serviceClient, user: { id: acepta.id, email: acepta.email } },
        invId!
      )
    ).toEqual({ success: true, data: { rol: 'admin' } })
    expect((await metricasDe(conAdmin.data.centroId))?.sin_admin).toBe(false)

    // El caso: la invitación sale, otra persona pasa a ser la admin, y luego se acepta.
    const tarde = await crearCentro(
      datosCentro(`Centro Tarde ${sufijo()}`, 'pendiente@example.test')
    )
    expect(tarde.success).toBe(true)
    if (!tarde.success) return
    centros.push(tarde.data.centroId)
    const llegaTarde = await usuario('Admin Llega Tarde')
    const otraAdmin = await usuario('Admin Que Se Adelanta')
    const { data: invTarde } = await cSuper.rpc('platform_invitar_admin', {
      p_centro_id: tarde.data.centroId,
      p_email: llegaTarde.email,
    })
    await asignarRol(otraAdmin.id, tarde.data.centroId, 'admin')
    expect(
      await acceptPendingInvitationCore(
        { serviceClient, user: { id: llegaTarde.id, email: llegaTarde.email } },
        invTarde!
      )
    ).toEqual({ success: false, error: 'auth.invitation.errors.centro_ya_tiene_admin' })
    const { count } = await serviceClient
      .from('roles_usuario')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', llegaTarde.id)
      .eq('centro_id', tarde.data.centroId)
      .is('deleted_at', null)
    expect(count).toBe(0)
  })
})
