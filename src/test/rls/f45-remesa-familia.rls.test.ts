import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestFamilia,
  createTestUser,
  crearFamiliaTutor,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * F-4-5 — get_mandatos_remesa a grano FAMILIA. Verifica que la RPC resuelve el mandato
 * por `recibos.familia_id` DIRECTO (antes puenteaba por nino_id, roto con nino_id NULL):
 *  - un recibo FAMILIAR (nino_id NULL) confirmado sepa resuelve el IBAN de su familia;
 *  - un recibo en BORRADOR enlazado NO sale de la RPC (gate defensivo);
 *  - un recibo confirmado NO-sepa no sale (filtro metodo='sepa');
 *  - un recibo enviado_banco SÍ sale (gate IN → re-descarga del XML preservada);
 *  - una familia sin mandato activo sale con iban/mandato NULL (→ familiasSinMandato).
 *
 * Gateado: F45_MIGRATION_APPLIED=1 (requiere la migración phase_f45 aplicada).
 */

const APPLIED = process.env.F45_MIGRATION_APPLIED === '1'
const IBAN = 'ES7620770024003102575766'

interface ReciboArgs {
  familiaId: string
  metodo: Database['public']['Enums']['metodo_pago']
  estado: Database['public']['Enums']['estado_recibo']
  total: number
  esporadico?: boolean
  fechaEnvioBanco?: string
}

describe.skipIf(!APPLIED)('F-4-5 — get_mandatos_remesa a grano familia', () => {
  let centro: { id: string }
  let admin: TestUser
  let cAdmin: SupabaseClient<Database>
  let famConMandato: string
  let famSinMandato: string
  let remesaId: string
  // recibos que se enlazan a la remesa
  const ids: Record<string, string> = {}
  const anio = 2026
  const mes = 9

  async function insertarReciboFamiliar(a: ReciboArgs): Promise<string> {
    // nino_id NULL a propósito: recibo familiar (grano F-4-1). serviceClient está exento
    // del freeze por estado (F-4-3), así que el INSERT en borrador pasa.
    // es_esporadico se parametriza: el índice idx_recibos_regular_familia_unico (F-4-1)
    // impone 1 recibo REGULAR por (familia, anio, mes); los esporádicos quedan fuera, así
    // que una misma familia puede llevar su regular + esporádicos en la misma remesa.
    // fecha_envio_banco: el CHECK recibos_envio_banco_fecha (B-6) exige que 'enviado_banco'
    // la lleve NOT NULL (y 'devuelto' además fecha_devolucion; aquí no usamos ese estado).
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: a.familiaId,
        nino_id: null,
        anio,
        mes,
        metodo: a.metodo,
        estado: a.estado,
        total_centimos: a.total,
        es_esporadico: a.esporadico ?? false,
        fecha_envio_banco: a.fechaEnvioBanco ?? null,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`insertarReciboFamiliar: ${error?.message}`)
    return data.id
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro F45')
    admin = await createTestUser({ nombre: 'Admin F45' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)

    // Familia CON mandato: un tutor titular registra el mandato (cifra el IBAN vía RPC).
    famConMandato = await createTestFamilia(centro.id)
    const tutor = await createTestUser({ nombre: 'Tutor F45' })
    await crearFamiliaTutor(famConMandato, tutor.id, 'titular')
    const cTutor = await clientFor(tutor)
    await cTutor.rpc('registrar_mandato_sepa', {
      p_familia_id: famConMandato,
      p_nino_id: null as unknown as string,
      p_iban: IBAN,
      p_titular: 'Ana Pérez',
      p_identificador_mandato: 'NIDO-F45-1',
      p_documento_path: '',
      p_firma_imagen: '',
      p_nombre_tecleado: 'Ana Pérez',
      p_texto_hash: 'a'.repeat(64),
      p_ip_address: null,
      p_user_agent: 'test',
      p_fecha_firma: '2026-08-01T10:00:00Z',
    })

    // Familia SIN mandato.
    famSinMandato = await createTestFamilia(centro.id)

    // Recibos familiares (nino_id NULL) enlazados a una única remesa. Sobre famConMandato
    // solo confirmadoSepa es REGULAR (el caso F-4-1 que importa); los demás son esporádicos
    // para no chocar con idx_recibos_regular_familia_unico (1 regular/familia/mes).
    ids.confirmadoSepa = await insertarReciboFamiliar({
      familiaId: famConMandato,
      metodo: 'sepa',
      estado: 'pendiente_procesar',
      total: 10000,
    })
    ids.borrador = await insertarReciboFamiliar({
      familiaId: famConMandato,
      metodo: 'sepa',
      estado: 'borrador',
      total: 5000,
      esporadico: true,
    })
    ids.efectivo = await insertarReciboFamiliar({
      familiaId: famConMandato,
      metodo: 'efectivo',
      estado: 'pendiente_procesar',
      total: 3000,
      esporadico: true,
    })
    ids.enviado = await insertarReciboFamiliar({
      familiaId: famConMandato,
      metodo: 'sepa',
      estado: 'enviado_banco',
      total: 6000,
      esporadico: true,
      fechaEnvioBanco: '2026-09-15', // CHECK recibos_envio_banco_fecha: enviado_banco ⇒ fecha NOT NULL
    })
    ids.sinMandato = await insertarReciboFamiliar({
      familiaId: famSinMandato,
      metodo: 'sepa',
      estado: 'pendiente_procesar',
      total: 4000,
    })

    const { data: remesa } = await serviceClient
      .from('remesas')
      .insert({ centro_id: centro.id, anio, mes, estado: 'borrador' })
      .select('id')
      .single()
    remesaId = remesa!.id
    await serviceClient.from('recibos_remesa').insert(
      Object.values(ids).map((recibo_id) => ({ centro_id: centro.id, remesa_id: remesaId, recibo_id }))
    )
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('recibos_remesa').delete().eq('centro_id', centro.id)
    await serviceClient.from('remesas').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centro.id)
    await serviceClient.from('familia_tutores').delete().eq('familia_id', famConMandato)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  }, 60_000)

  it('resuelve el IBAN de un recibo FAMILIAR (nino_id NULL) vía su familia', async () => {
    const { data, error } = await cAdmin.rpc('get_mandatos_remesa', { p_remesa_id: remesaId })
    expect(error).toBeNull()
    const fila = (data ?? []).find((f) => f.recibo_id === ids.confirmadoSepa)
    expect(fila).toBeDefined()
    expect(fila!.iban).toBe(IBAN)
    expect(fila!.identificador_mandato).toBe('NIDO-F45-1')
    expect(fila!.familia_id).toBe(famConMandato)
    expect(fila!.familia_etiqueta).toBeTruthy()
  })

  it('un BORRADOR enlazado NO sale de la RPC (gate defensivo)', async () => {
    const { data } = await cAdmin.rpc('get_mandatos_remesa', { p_remesa_id: remesaId })
    expect((data ?? []).some((f) => f.recibo_id === ids.borrador)).toBe(false)
  })

  it('un confirmado NO-sepa no es remesable (filtro metodo=sepa)', async () => {
    const { data } = await cAdmin.rpc('get_mandatos_remesa', { p_remesa_id: remesaId })
    expect((data ?? []).some((f) => f.recibo_id === ids.efectivo)).toBe(false)
  })

  it('un enviado_banco SÍ sale (gate IN → re-descarga del XML preservada)', async () => {
    const { data } = await cAdmin.rpc('get_mandatos_remesa', { p_remesa_id: remesaId })
    expect((data ?? []).some((f) => f.recibo_id === ids.enviado)).toBe(true)
  })

  it('familia sin mandato → sale con iban/mandato NULL', async () => {
    const { data } = await cAdmin.rpc('get_mandatos_remesa', { p_remesa_id: remesaId })
    const fila = (data ?? []).find((f) => f.recibo_id === ids.sinMandato)
    expect(fila).toBeDefined()
    expect(fila!.iban).toBeNull()
    expect(fila!.identificador_mandato).toBeNull()
    expect(fila!.familia_id).toBe(famSinMandato)
  })
})
