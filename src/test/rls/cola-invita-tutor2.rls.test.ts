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
// `sendInvitation` de verdad, contada; `fallar` simula que la invitación no sale.
const espia = vi.hoisted(() => ({ llamadas: 0, fallar: false }))
vi.mock('@/features/auth/actions/send-invitation', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/auth/actions/send-invitation')>()
  return {
    ...real,
    sendInvitation: async (...args: Parameters<typeof real.sendInvitation>) => {
      espia.llamadas++
      if (espia.fallar)
        return { success: false as const, error: 'auth.invitation.errors.insert_failed' }
      return real.sendInvitation(...args)
    },
  }
})

const { aprobarCambio } = await import('@/features/cambios-pendientes/actions/decidir')
const { reenviarInvitacionTutor2 } = await import('@/features/matriculas/actions/invitacion-tutor2')
const { getAltasEnProceso } = await import('@/features/matriculas/queries/get-altas-en-proceso')

/**
 * La cola invita sola al segundo tutor (2026-11-04). Antes, aprobar un cambio de email del segundo
 * tutor, o su alta después de validar, escribía la fila y no invitaba a nadie: esa persona se
 * quedaba fuera sin que nadie se enterara. Con las acciones de verdad contra la BD y el GoTrue del
 * CI, y una familia con dos hijos: la invitación es de la familia y el cambio puede entrar por el
 * hermano que no la tiene. Fixtures ficticios, fechados el 2026-11-04.
 */
describe('La cola invita al segundo tutor al aprobar un email nuevo', () => {
  let centro: TestCentro
  let directora: TestUser
  let tutor1: TestUser
  let familia: string
  let nora: string
  let leo: string
  const sufijo = Date.now()
  const emailX = `t2-cola-x-${sufijo}@nido.test`
  const emailY = `t2-cola-y-${sufijo}@nido.test`
  const emailZ = `t2-cola-z-${sufijo}@nido.test`

  const datos = (email: string, calle = 'Calle Ficticia') => ({
    tipo_vinculo: 'tutor_legal_secundario',
    email,
    nombre_completo: 'Segundo Tutor Cola',
    direccion_calle: calle,
    direccion_numero: '1',
    direccion_cp: '46000',
    direccion_ciudad: 'Ciudad Demo',
  })

  /** Lo que registra el tutor 1 desde su ficha con el alta validada (`registrarCambioPendiente`). */
  async function cambio(ninoId: string, payload: ReturnType<typeof datos>) {
    const { data, error } = await serviceClient
      .from('cambios_pendientes')
      .insert({
        centro_id: centro.id,
        nino_id: ninoId,
        registro_id: ninoId,
        entidad: 'datos_tutor',
        solicitado_por: tutor1.id,
        payload,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    return data!.id
  }

  async function estadoCambio(id: string) {
    const { data } = await serviceClient
      .from('cambios_pendientes')
      .select('estado')
      .eq('id', id)
      .single()
    return data?.estado
  }

  /** Las invitaciones sin aceptar del segundo tutor en TODA la familia. */
  async function invitacionesFamilia() {
    const { data, error } = await serviceClient
      .from('invitaciones')
      .select('id, email, nino_id')
      .in('nino_id', [nora, leo])
      .eq('tipo_vinculo', 'tutor_legal_secundario')
      .is('accepted_at', null)
    expect(error).toBeNull()
    return data ?? []
  }

  async function segundoTutor() {
    const { data, error } = await serviceClient
      .from('familia_tutores')
      .select('email, direccion_calle')
      .eq('familia_id', familia)
      .eq('rol_familia', 'segundo_tutor')
      .is('deleted_at', null)
      .maybeSingle()
    expect(error).toBeNull()
    return data
  }

  async function cuentasAuth(email: string) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ perPage: 1000 })
    expect(error).toBeNull()
    return (data?.users ?? []).filter((u) => u.email?.toLowerCase() === email)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Cola Tutor2')
    const curso = (await createTestCurso(centro.id)).id
    const aula = (await createTestAula(centro.id, curso, 'Patitos Cola', [2025])).id
    directora = await createTestUser({ nombre: 'Directora Cola' })
    tutor1 = await createTestUser({ nombre: 'Tutor Uno Cola' })
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(tutor1.id, centro.id, 'tutor_legal')

    // Dos hermanos con el alta validada; el tutor 1 con cuenta y vínculo; sin segundo tutor.
    familia = await createTestFamilia(centro.id)
    await crearFamiliaTutor(familia, tutor1.id, 'titular')
    const ids: string[] = []
    for (const nombre of ['Nora', 'Leo']) {
      const { data: n, error } = await serviceClient
        .from('ninos')
        .insert({ centro_id: centro.id, nombre, primer_apellido: 'Cola Demo', familia_id: familia })
        .select('id')
        .single()
      expect(error).toBeNull()
      await crearVinculo(n!.id, tutor1.id, 'tutor_legal_principal')
      const mat = await matricular(n!.id, aula, curso)
      expect(
        (
          await serviceClient
            .from('matriculas')
            .update({ estado: 'activa', activada_at: new Date().toISOString() })
            .eq('id', mat)
        ).error
      ).toBeNull()
      ids.push(n!.id)
    }
    ;[nora, leo] = ids as [string, string]
  })

  afterAll(async () => {
    sesion.actual = null
    for (const email of [emailX, emailY, emailZ]) {
      for (const u of await cuentasAuth(email)) await serviceClient.auth.admin.deleteUser(u.id)
    }
    if (centro) await deleteTestCentro(centro.id)
    for (const u of [directora, tutor1]) if (u) await deleteTestUser(u.id)
  })

  it('añadir un segundo tutor por primera vez después de validar le invita', async () => {
    // Premisa: no hay segundo tutor, ni invitación, ni cuenta, ni ninguna llamada.
    expect(await segundoTutor()).toBeNull()
    expect(await invitacionesFamilia()).toHaveLength(0)
    expect(await cuentasAuth(emailX)).toHaveLength(0)
    expect(espia.llamadas).toBe(0)

    sesion.actual = await clientFor(directora)
    const id = await cambio(nora, datos(emailX))
    expect(await aprobarCambio(id)).toEqual({ success: true, data: { id, tutor2: 'invitado' } })
    expect(await estadoCambio(id)).toBe('aprobado')
    expect((await segundoTutor())?.email).toBe(emailX)
    const invs = await invitacionesFamilia()
    expect(invs.map((i) => [i.email, i.nino_id])).toEqual([[emailX, nora]])
    expect(await cuentasAuth(emailX)).toHaveLength(1)
    expect(espia.llamadas).toBe(1)
  })

  it('aprobar un cambio de dirección no invita: no se mandan correos por cambiar un piso', async () => {
    const antes = await invitacionesFamilia()
    expect(antes).toHaveLength(1)
    const llamadas = espia.llamadas

    sesion.actual = await clientFor(directora)
    const id = await cambio(leo, datos(emailX, 'Otra Calle Demo'))
    expect(await aprobarCambio(id)).toEqual({ success: true, data: { id, tutor2: 'no_aplica' } })
    // Premisa: el cambio se aplicó de verdad; lo que no hubo fue invitación.
    expect((await segundoTutor())?.direccion_calle).toBe('Otra Calle Demo')
    expect(espia.llamadas).toBe(llamadas)
    expect((await invitacionesFamilia()).map((i) => i.id)).toEqual(antes.map((i) => i.id))
    expect(await cuentasAuth(emailX)).toHaveLength(1)
  })

  it('aprobar un cambio de email invita al nuevo y se lleva lo del viejo, también del hermano', async () => {
    // La invitación del viejo cuelga de Nora; el cambio entra por Leo.
    const viejas = await cuentasAuth(emailX)
    expect(viejas).toHaveLength(1)
    expect((await invitacionesFamilia()).map((i) => i.nino_id)).toEqual([nora])

    sesion.actual = await clientFor(directora)
    const id = await cambio(leo, datos(emailY))
    expect(await aprobarCambio(id)).toEqual({ success: true, data: { id, tutor2: 'invitado' } })
    const invs = await invitacionesFamilia()
    expect(invs.map((i) => i.email)).toEqual([emailY])
    expect(await cuentasAuth(emailX)).toHaveLength(0)
    const { data: filaUsuario } = await serviceClient
      .from('usuarios')
      .select('id')
      .eq('id', viejas[0]!.id)
      .maybeSingle()
    expect(filaUsuario).toBeNull()
    expect(await cuentasAuth(emailY)).toHaveLength(1)
  })

  it('si la invitación no sale, la aprobación se queda y se reenvía a mano desde la lista', async () => {
    sesion.actual = await clientFor(directora)
    espia.fallar = true
    let id: string
    try {
      id = await cambio(nora, datos(emailZ))
      expect(await aprobarCambio(id)).toEqual({ success: true, data: { id, tutor2: 'no_salio' } })
    } finally {
      espia.fallar = false
    }
    // El dato está aprobado y aplicado; la invitación vieja se fue y la nueva no salió.
    expect(await estadoCambio(id)).toBe('aprobado')
    expect((await segundoTutor())?.email).toBe(emailZ)
    expect(await invitacionesFamilia()).toHaveLength(0)
    const altas = await getAltasEnProceso(await clientFor(directora), centro.id)
    const fila = altas?.find((a) => a.clase === 'tutor2' && a.email === emailZ)
    expect(fila?.clase === 'tutor2' && fila.estado).toBe('sin_invitar')

    // Desde la lista, a mano.
    expect(await reenviarInvitacionTutor2(fila!.ninoId)).toEqual({
      success: true,
      data: { email: emailZ },
    })
    expect((await invitacionesFamilia()).map((i) => i.email)).toEqual([emailZ])
    expect(await cuentasAuth(emailZ)).toHaveLength(1)
  })
})
