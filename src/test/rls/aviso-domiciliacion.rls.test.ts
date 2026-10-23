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
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Aviso a Dirección cuando una familia firma o cambia su domiciliación por su cuenta.
 *
 * Fuera del alta, el método de pago no cambia solo (PR-7), y la directora solo se enteraba si
 * abría la ficha. Ahora el inicio de Dirección avisa de las familias que firmaron o cambiaron su
 * mandato (firma digital del tutor) estando ya dadas de alta, hasta que abre su ficha. Con las
 * consultas reales y la sesión de verdad de cada rol.
 */

const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))

const { getAvisosInicio } = await import('@/features/notificaciones/queries/get-avisos-inicio')
const { marcarDomiciliacionVista } =
  await import('@/features/notificaciones/actions/marcar-domiciliacion-vista')

const IBAN = 'ES9121000418450200051332'
const IBAN_OTRO = 'ES7921000813610123456789'

function mandato(familiaId: string, iban: string, id: string, metodo: 'digital' | 'presencial') {
  return {
    p_familia_id: familiaId,
    p_nino_id: null,
    p_iban: iban,
    p_titular: 'Titular Aviso',
    p_identificador_mandato: id,
    p_documento_path: null,
    p_firma_imagen: '',
    p_nombre_tecleado: 'Titular Aviso',
    p_texto_hash: null,
    p_ip_address: null,
    p_user_agent: null,
    p_fecha_firma: '2026-10-01T10:00:00Z',
    p_metodo: metodo,
  } as never
}

describe('Aviso a Dirección: domiciliación firmada o cambiada por la familia', () => {
  let centro: { id: string }
  let admin: TestUser
  let profe: TestUser
  let tutor: TestUser
  let tutorAlta: TestUser
  let familia: string // ya dada de alta: su niño tiene la matrícula activada
  let familiaAlta: string // en su alta: matrícula pendiente
  let familiaPresencial: string // ya dada de alta; el mandato lo registra Dirección
  let cAdmin: SupabaseClient<Database>
  let cProfe: SupabaseClient<Database>
  let cTutor: SupabaseClient<Database>
  let cTutorAlta: SupabaseClient<Database>

  async function avisoAdmin(): Promise<string[]> {
    sesion.actual = cAdmin
    return (await getAvisosInicio('admin', centro.id)).familiasDomiciliacionNueva
  }

  async function activadas(id: string): Promise<number> {
    const { data } = await serviceClient
      .from('matriculas')
      .select('id, nino:ninos!inner(familia_id)')
      .eq('nino.familia_id', id)
      .not('activada_at', 'is', null)
    return (data ?? []).length
  }

  async function nino(familiaId: string, nombre: string): Promise<string> {
    const { data, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: familiaId,
        nombre,
        apellidos: 'Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`nino: ${error?.message}`)
    return data.id
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Aviso Domiciliacion')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Aviso Domiciliacion' })
    profe = await createTestUser({ nombre: 'Profe Aviso Domiciliacion' })
    tutor = await createTestUser({ nombre: 'Tutor Aviso Domiciliacion' })
    tutorAlta = await createTestUser({ nombre: 'Tutor Alta Aviso Domiciliacion' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')

    familia = await createTestFamilia(centro.id)
    await crearFamiliaTutor(familia, tutor.id, 'titular')
    await matricular(await nino(familia, 'Nino Aviso'), aula.id, curso.id)

    familiaAlta = await createTestFamilia(centro.id)
    await crearFamiliaTutor(familiaAlta, tutorAlta.id, 'titular')
    const matAlta = await serviceClient.from('matriculas').insert({
      nino_id: await nino(familiaAlta, 'Nino Alta Aviso'),
      aula_id: aula.id,
      curso_academico_id: curso.id,
      fecha_alta: '2026-09-01',
      estado: 'pendiente',
    })
    if (matAlta.error) throw new Error(`matricula alta: ${matAlta.error.message}`)

    familiaPresencial = await createTestFamilia(centro.id)
    await matricular(await nino(familiaPresencial, 'Nino Presencial Aviso'), aula.id, curso.id)

    cAdmin = await clientFor(admin)
    cProfe = await clientFor(profe)
    cTutor = await clientFor(tutor)
    cTutorAlta = await clientFor(tutorAlta)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    for (const u of [admin, profe, tutor, tutorAlta]) await deleteTestUser(u.id)
  })

  it('premisa: dos familias ya dadas de alta, una en su alta, y ningún aviso todavía', async () => {
    expect(await activadas(familia)).toBe(1)
    expect(await activadas(familiaPresencial)).toBe(1)
    expect(await activadas(familiaAlta)).toBe(0)
    expect(await avisoAdmin()).toEqual([])
  })

  it('la familia ya dada de alta firma su mandato: Dirección recibe el aviso', async () => {
    const { error } = await cTutor.rpc(
      'registrar_mandato_sepa',
      mandato(familia, IBAN, 'AVISO-1', 'digital')
    )
    expect(error).toBeNull()
    expect(await avisoAdmin()).toEqual([familia])
  })

  it('lo firmado en el alta no avisa: Dirección lo ve al validarla', async () => {
    const { error } = await cTutorAlta.rpc(
      'registrar_mandato_sepa',
      mandato(familiaAlta, IBAN, 'AVISO-ALTA', 'digital')
    )
    expect(error).toBeNull()
    expect(await avisoAdmin()).toEqual([familia])
  })

  it('el mandato presencial que registra Dirección no le avisa a ella misma', async () => {
    const { error } = await cAdmin.rpc(
      'registrar_mandato_sepa',
      mandato(familiaPresencial, IBAN, 'AVISO-PRES', 'presencial')
    )
    expect(error).toBeNull()
    expect(await avisoAdmin()).toEqual([familia])
  })

  it('la profe no recibe el aviso', async () => {
    sesion.actual = cProfe
    expect((await getAvisosInicio('profe', centro.id)).familiasDomiciliacionNueva).toEqual([])
  })

  it('abrir la ficha apaga el aviso, y el cambio de cuenta posterior vuelve a avisar', async () => {
    sesion.actual = cAdmin
    expect(await marcarDomiciliacionVista(familia)).toEqual({ success: true, data: undefined })
    expect(await avisoAdmin()).toEqual([])

    const { error } = await cTutor.rpc(
      'sustituir_mandato_sepa',
      mandato(familia, IBAN_OTRO, 'AVISO-2', 'digital')
    )
    expect(error).toBeNull()
    expect(await avisoAdmin()).toEqual([familia])
  })
})
