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
vi.mock('@/shared/lib/correo/enviar-correo', () => ({
  enviarCorreo: async () => ({ enviado: true }),
}))

const { cancelarInvitacionTutor2, reenviarInvitacionTutor2 } =
  await import('@/features/matriculas/actions/invitacion-tutor2')
const { getAltasEnProceso } = await import('@/features/matriculas/queries/get-altas-en-proceso')

/**
 * Reenviar y cancelar la invitación del segundo tutor (20261231120000), con las acciones de verdad
 * contra la BD y el GoTrue del CI. Lo que se mide, y por qué importa (medido el 2026-11-04): si la
 * familia corrige el email del segundo tutor, o lo añade después de validar, la cola escribe la
 * fila y nadie le invita. El reenvío lo cierra, y no puede dejar basura: ni una invitación ni una
 * cuenta provisional de más. Fixtures ficticios, fechados el 2026-11-04.
 */
describe('El segundo tutor: reenviar y cancelar su invitación', () => {
  let centro: TestCentro
  let otro: TestCentro
  let directora: TestUser
  let directoraOtro: TestUser
  let profe: TestUser
  let tutor1: TestUser
  let familia: string
  let nino: string
  const sufijo = Date.now()
  const emailViejo = `t2-viejo-${sufijo}@nido.test`
  const emailNuevo = `t2-nuevo-${sufijo}@nido.test`

  async function como(u: TestUser) {
    sesion.actual = await clientFor(u)
  }

  async function invitacionesT2() {
    const { data, error } = await serviceClient
      .from('invitaciones')
      .select('id, email, expires_at')
      .eq('nino_id', nino)
      .eq('tipo_vinculo', 'tutor_legal_secundario')
      .is('accepted_at', null)
    expect(error).toBeNull()
    return data ?? []
  }

  /** Las cuentas de Auth de ese email: por la Admin API, no por `usuarios`. */
  async function cuentasAuth(email: string) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ perPage: 1000 })
    expect(error).toBeNull()
    return (data?.users ?? []).filter((u) => u.email?.toLowerCase() === email)
  }

  async function filaTutor2() {
    const altas = await getAltasEnProceso(await clientFor(directora), centro.id)
    expect(altas).not.toBeNull()
    return altas!.find((a) => a.ninoId === nino)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Tutor2')
    otro = await createTestCentro('Centro Tutor2 Otro')
    const curso = (await createTestCurso(centro.id)).id
    const aula = (await createTestAula(centro.id, curso, 'Patitos Tutor2', [2025])).id
    directora = await createTestUser({ nombre: 'Directora Tutor2' })
    directoraOtro = await createTestUser({ nombre: 'Directora Tutor2 Otro' })
    profe = await createTestUser({ nombre: 'Profe Tutor2' })
    tutor1 = await createTestUser({ nombre: 'Tutor Uno Tutor2' })
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(directoraOtro.id, otro.id, 'directora')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(tutor1.id, centro.id, 'tutor_legal')

    // Una familia con el alta ya validada: tutor 1 con cuenta y su vínculo, el niño con la
    // matrícula activa, y un segundo tutor sin cuenta añadido después de validar: sin invitación.
    familia = await createTestFamilia(centro.id)
    await crearFamiliaTutor(familia, tutor1.id, 'titular')
    const { data: n, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        nombre: 'Nora',
        primer_apellido: 'Tutor Dos',
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
          email: emailViejo,
          nombre_completo: 'Segundo Tutor Dos',
        })
      ).error
    ).toBeNull()
  })

  afterAll(async () => {
    sesion.actual = null
    for (const email of [emailViejo, emailNuevo]) {
      for (const u of await cuentasAuth(email)) await serviceClient.auth.admin.deleteUser(u.id)
    }
    if (centro) await deleteTestCentro(centro.id)
    if (otro) await deleteTestCentro(otro.id)
    for (const u of [directora, directoraOtro, profe, tutor1]) if (u) await deleteTestUser(u.id)
  })

  it('el segundo tutor añadido después de validar sale en la lista, sin invitación', async () => {
    // Premisa: no hay ninguna invitación ni cuenta para ese email.
    expect(await invitacionesT2()).toHaveLength(0)
    expect(await cuentasAuth(emailViejo)).toHaveLength(0)
    const fila = await filaTutor2()
    expect(fila?.clase).toBe('tutor2')
    expect(fila?.clase === 'tutor2' && fila.estado).toBe('sin_invitar')
    expect(fila?.clase === 'tutor2' && fila.email).toBe(emailViejo)
  })

  it('reenviar invita, y reenviar otra vez deja una cuenta y una invitación, no dos', async () => {
    await como(directora)
    const r1 = await reenviarInvitacionTutor2(nino)
    expect(r1).toEqual({ success: true, data: { email: emailViejo } })
    // Control positivo de la medida: tras el primero, la invitación y la cuenta provisional existen.
    const tras1 = await invitacionesT2()
    expect(tras1).toHaveLength(1)
    const cuentas1 = await cuentasAuth(emailViejo)
    expect(cuentas1).toHaveLength(1)
    expect(cuentas1[0]!.email_confirmed_at ?? null).toBeNull()

    const r2 = await reenviarInvitacionTutor2(nino)
    expect(r2.success).toBe(true)
    const tras2 = await invitacionesT2()
    expect(tras2).toHaveLength(1)
    expect(tras2[0]!.id).toBe(tras1[0]!.id)
    expect(Date.parse(tras2[0]!.expires_at)).toBeGreaterThanOrEqual(
      Date.parse(tras1[0]!.expires_at)
    )
    const cuentas2 = await cuentasAuth(emailViejo)
    expect(cuentas2).toHaveLength(1)
    expect(cuentas2[0]!.id).toBe(cuentas1[0]!.id)

    const fila = await filaTutor2()
    expect(fila?.clase === 'tutor2' && fila.estado).toBe('abierta')
  })

  it('con el email corregido por la cola, reenviar se lleva la invitación y la cuenta del viejo', async () => {
    const viejas = await cuentasAuth(emailViejo)
    expect(viejas).toHaveLength(1)
    // Lo que escribe en la ficha `aplicarCambioPendiente` al aprobar. La invitación que la cola manda
    // después (`aprobarCambio`) va aparte, en cola-invita-tutor2.rls.test.ts: aquí se mide el botón.
    expect(
      (
        await serviceClient
          .from('familia_tutores')
          .update({ email: emailNuevo })
          .eq('familia_id', familia)
          .eq('rol_familia', 'segundo_tutor')
      ).error
    ).toBeNull()
    const antes = await filaTutor2()
    expect(antes?.clase === 'tutor2' && antes.emailInvitacion).toBe(emailViejo)
    expect(antes?.clase === 'tutor2' && antes.email).toBe(emailNuevo)

    await como(directora)
    expect(await reenviarInvitacionTutor2(nino)).toEqual({
      success: true,
      data: { email: emailNuevo },
    })
    const invs = await invitacionesT2()
    expect(invs.map((i) => i.email)).toEqual([emailNuevo])
    expect(await cuentasAuth(emailViejo)).toHaveLength(0)
    const { data: filaUsuario } = await serviceClient
      .from('usuarios')
      .select('id')
      .eq('id', viejas[0]!.id)
      .maybeSingle()
    expect(filaUsuario).toBeNull()
    expect(await cuentasAuth(emailNuevo)).toHaveLength(1)
  })

  it('solo Dirección del centro: la profe y la directora de otro centro no tocan nada', async () => {
    const antes = await invitacionesT2()
    expect(antes).toHaveLength(1)
    for (const u of [profe, directoraOtro]) {
      await como(u)
      expect.soft(await cancelarInvitacionTutor2(nino), u.email).toEqual({
        success: false,
        error: 'matricula.errors.no_autorizado',
      })
      expect.soft(await reenviarInvitacionTutor2(nino), u.email).toEqual({
        success: false,
        error: 'matricula.errors.no_autorizado',
      })
    }
    expect((await invitacionesT2()).map((i) => i.id)).toEqual(antes.map((i) => i.id))
    expect(await cuentasAuth(emailNuevo)).toHaveLength(1)
  })

  it('cancelar se lleva la invitación y su cuenta, y el segundo tutor sigue en la lista sin invitación', async () => {
    await como(directora)
    expect(await cancelarInvitacionTutor2(nino)).toEqual({
      success: true,
      data: { invitaciones: 1 },
    })
    expect(await invitacionesT2()).toHaveLength(0)
    expect(await cuentasAuth(emailNuevo)).toHaveLength(0)
    const fila = await filaTutor2()
    expect(fila?.clase === 'tutor2' && fila.estado).toBe('sin_invitar')
    // Y queda quién lo hizo, sin datos de la familia.
    const { data: audit } = await serviceClient
      .from('audit_log')
      .select('usuario_id, valores_despues')
      .eq('tabla', 'invitacion_tutor2')
      .eq('registro_id', centro.id)
    expect(audit?.map((a) => (a.valores_despues as { accion: string }).accion).sort()).toEqual([
      'cancelada',
      'reenviada',
    ])
    expect(audit?.every((a) => a.usuario_id === directora.id)).toBe(true)
    expect(JSON.stringify(audit)).not.toContain('@')
  })

  it('el segundo tutor que ya tiene cuenta no se reenvía', async () => {
    const cuenta = await createTestUser({ nombre: 'Segundo Con Cuenta Tutor2' })
    try {
      expect(
        (
          await serviceClient
            .from('familia_tutores')
            .update({ usuario_id: cuenta.id })
            .eq('familia_id', familia)
            .eq('rol_familia', 'segundo_tutor')
        ).error
      ).toBeNull()
      await como(directora)
      expect(await reenviarInvitacionTutor2(nino)).toEqual({
        success: false,
        error: 'matricula.errors.tutor2_ya_entro',
      })
      expect(await invitacionesT2()).toHaveLength(0)
    } finally {
      await serviceClient
        .from('familia_tutores')
        .update({ usuario_id: null })
        .eq('familia_id', familia)
        .eq('rol_familia', 'segundo_tutor')
      await deleteTestUser(cuenta.id)
    }
  })
})
