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
  type TestNino,
  type TestUser,
} from './setup'

/**
 * Multicentro — contadores de la barra lateral y `/agenda` por centro.
 *
 * Un usuario profe en A y tutor en B (ya posible desde la Fase 1) veía en el badge y en la lista
 * de recordatorios de A lo de B, y al revés. Las dos RPCs de los contadores reciben ahora el
 * centro, y sus versiones sin centro ya no existen. Cada caso empieza por su premisa: sin acotar,
 * la RLS le deja ver lo de los dos centros.
 */

const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))

const { contarRecordatoriosPendientes } =
  await import('@/features/recordatorios/queries/contar-pendientes')
const { contarInvitacionesPendientes } =
  await import('@/features/agenda/queries/contar-invitaciones-pendientes')
const { getRecordatoriosPendientesDeUsuario } =
  await import('@/features/recordatorios/queries/get-recordatorios-usuario')
const { getNinosParaRecordatorios } =
  await import('@/features/recordatorios/queries/get-ninos-para-recordatorios')

describe('Multicentro — contadores y agenda por centro', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let adminA: TestUser
  let adminB: TestUser
  let usuario: TestUser // profe en A, tutor en B
  let cUsuario: SupabaseClient<Database>
  let ninoB: TestNino
  let recordatorioA: string
  let recordatorioB: string
  const citas: string[] = []

  async function nuevaCita(centroId: string, organizador: string): Promise<string> {
    const { data, error } = await serviceClient
      .from('citas')
      .insert({
        centro_id: centroId,
        organizador_id: organizador,
        tipo: 'visita',
        titulo: 'Cita contadores',
        fecha: '2099-06-01',
        hora_inicio: '10:00',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`cita: ${error?.message}`)
    const inv = await serviceClient
      .from('cita_invitados')
      .insert({ cita_id: data.id, centro_id: centroId, usuario_id: usuario.id })
    if (inv.error) throw new Error(`invitado: ${inv.error.message}`)
    citas.push(data.id)
    return data.id
  }

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Contadores A')
    centroB = await createTestCentro('Centro Contadores B')
    adminA = await createTestUser({ nombre: 'Admin Contadores A' })
    adminB = await createTestUser({ nombre: 'Admin Contadores B' })
    usuario = await createTestUser({ nombre: 'Profe A Tutor B' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    await asignarRol(adminB.id, centroB.id, 'admin')
    await asignarRol(usuario.id, centroA.id, 'profe')
    await asignarRol(usuario.id, centroB.id, 'tutor_legal')
    ninoB = await createTestNino(centroB.id, 'Hijo Contadores B')
    await crearVinculo(ninoB.id, usuario.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })

    const a = await serviceClient
      .from('recordatorios')
      .insert({
        centro_id: centroA.id,
        creado_por: adminA.id,
        destinatario: 'profes_centro',
        titulo: 'Para las profes de A',
      })
      .select('id')
      .single()
    if (a.error || !a.data) throw new Error(`recordatorio A: ${a.error?.message}`)
    recordatorioA = a.data.id
    const b = await serviceClient
      .from('recordatorios')
      .insert({
        centro_id: centroB.id,
        creado_por: adminB.id,
        destinatario: 'familia_individual',
        nino_id: ninoB.id,
        titulo: 'Para la familia en B',
      })
      .select('id')
      .single()
    if (b.error || !b.data) throw new Error(`recordatorio B: ${b.error?.message}`)
    recordatorioB = b.data.id

    await nuevaCita(centroA.id, adminA.id)
    await nuevaCita(centroB.id, adminB.id)

    cUsuario = await clientFor(usuario)
  }, 90_000)

  afterAll(async () => {
    sesion.actual = null
    if (citas.length > 0) await serviceClient.from('citas').delete().in('id', citas)
    await serviceClient.from('recordatorios').delete().in('id', [recordatorioA, recordatorioB])
    for (const c of [centroA, centroB]) if (c) await deleteTestCentro(c.id)
    for (const u of [adminA, adminB, usuario]) if (u) await deleteTestUser(u.id)
  }, 90_000)

  it('premisa: sin acotar, la RLS le deja ver lo de los dos centros', async () => {
    const { data: recordatorios } = await cUsuario
      .from('recordatorios')
      .select('id')
      .is('completado_en', null)
    expect((recordatorios ?? []).map((r) => r.id).sort()).toEqual(
      [recordatorioA, recordatorioB].sort()
    )
    const { data: invitaciones } = await cUsuario
      .from('cita_invitados')
      .select('cita_id')
      .eq('usuario_id', usuario.id)
    expect((invitaciones ?? []).map((i) => i.cita_id).sort()).toEqual([...citas].sort())
  })

  it('las RPCs sin centro ya no existen', async () => {
    const sinCentroR = await cUsuario.rpc('contar_recordatorios_pendientes' as never)
    expect(sinCentroR.error?.code).toBe('PGRST202')
    const sinCentroI = await cUsuario.rpc('contar_invitaciones_pendientes' as never)
    expect(sinCentroI.error?.code).toBe('PGRST202')
  })

  it('badge de recordatorios: uno en cada centro, el suyo', async () => {
    sesion.actual = cUsuario
    expect(await contarRecordatoriosPendientes(centroA.id)).toBe(1)
    expect(await contarRecordatoriosPendientes(centroB.id)).toBe(1)
  })

  it('badge de la agenda: una invitación en cada centro, la suya', async () => {
    sesion.actual = cUsuario
    expect(await contarInvitacionesPendientes(centroA.id)).toBe(1)
    expect(await contarInvitacionesPendientes(centroB.id)).toBe(1)
  })

  it('lista de recordatorios: solo los del centro', async () => {
    sesion.actual = cUsuario
    expect((await getRecordatoriosPendientesDeUsuario(centroA.id)).map((r) => r.id)).toEqual([
      recordatorioA,
    ])
    expect((await getRecordatoriosPendientesDeUsuario(centroB.id)).map((r) => r.id)).toEqual([
      recordatorioB,
    ])
  })

  it('niños para recordatorios y citas: solo los del centro', async () => {
    sesion.actual = cUsuario
    const { data: todos } = await cUsuario.from('ninos').select('id').is('deleted_at', null)
    expect((todos ?? []).map((n) => n.id)).toContain(ninoB.id)

    expect(await getNinosParaRecordatorios(centroA.id)).toEqual([])
    expect((await getNinosParaRecordatorios(centroB.id)).map((n) => n.id)).toEqual([ninoB.id])
  })
})
