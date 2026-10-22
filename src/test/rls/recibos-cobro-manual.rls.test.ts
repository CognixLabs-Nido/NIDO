import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * PR-1a (`20261105120000`) — cobrar a mano en efectivo o por transferencia.
 *
 *  - Un pendiente que no es SEPA se cobra a mano con su forma, su fecha y una nota.
 *  - Un SEPA pendiente no (va por remesa), ni un borrador: lo para el trigger
 *    `recibos_validar_cobro_manual`, también con service_role.
 *  - Sin forma o sin fecha no hay cobrado_manual (CHECK), y la forma solo es efectivo o
 *    transferencia.
 *  - La nota no entra en audit_log (la forma y la fecha sí); el export del art. 15 lleva las tres.
 *  - Lo cobra Dirección: la tutora de la familia no.
 */

type Recibo = Database['public']['Tables']['recibos']['Insert']

describe('PR-1a — cobro manual de recibos', () => {
  let centro: { id: string }
  let familia: string
  let directora: TestUser
  let tutora: TestUser
  let cDirectora: SupabaseClient<Database>
  let cTutora: SupabaseClient<Database>

  async function recibo(over: Partial<Recibo>): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        anio: 2026,
        mes: 1,
        estado: 'pendiente_procesar',
        total_centimos: 1000,
        es_esporadico: true,
        concepto_esporadico: 'Cobro manual PR-1a',
        ...over,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    return data.id
  }

  const cobro = {
    estado: 'cobrado_manual' as const,
    cobro_forma: 'efectivo' as const,
    cobro_fecha: '2026-01-20',
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Cobro Manual')
    const nino = await createTestNino(centro.id, 'Nino Cobro Manual')
    familia = nino.familia_id

    directora = await createTestUser({ nombre: 'Directora Cobro Manual' })
    await asignarRol(directora.id, centro.id, 'directora')
    cDirectora = await clientFor(directora)

    tutora = await createTestUser({ nombre: 'Tutora Cobro Manual' })
    await asignarRol(tutora.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(familia, tutora.id)
    cTutora = await clientFor(tutora)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await deleteTestUser(directora.id)
    await deleteTestUser(tutora.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('premisa: la directora lee los recibos de la familia y la tutora también', async () => {
    const id = await recibo({ metodo: 'efectivo' })
    expect(
      (await cDirectora.from('recibos').select('id').eq('id', id).maybeSingle()).data?.id
    ).toBe(id)
    expect((await cTutora.from('recibos').select('id').eq('id', id).maybeSingle()).data?.id).toBe(
      id
    )
  })

  it('un pendiente en efectivo: la directora lo cobra con forma, fecha y nota', async () => {
    const id = await recibo({ metodo: 'efectivo' })
    const { data, error } = await cDirectora
      .from('recibos')
      .update({ ...cobro, cobro_nota: 'Pagado en secretaría' })
      .eq('id', id)
      .select('estado, cobro_forma, cobro_fecha, cobro_nota, fecha_envio_banco')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data).toEqual({
      estado: 'cobrado_manual',
      cobro_forma: 'efectivo',
      cobro_fecha: '2026-01-20',
      cobro_nota: 'Pagado en secretaría',
      fecha_envio_banco: null,
    })
  })

  it('sin método y por transferencia, también', async () => {
    const id = await recibo({ metodo: null })
    const { error } = await cDirectora
      .from('recibos')
      .update({ ...cobro, cobro_forma: 'transferencia' })
      .eq('id', id)
    expect(error).toBeNull()
  })

  it('un SEPA pendiente no: va por remesa (la directora y service_role)', async () => {
    const id = await recibo({ metodo: 'sepa' })
    const r1 = await cDirectora.from('recibos').update(cobro).eq('id', id)
    expect(r1.error?.code).toBe('P0001')
    expect(r1.error?.hint).toBe('sepa_por_remesa')
    const r2 = await serviceClient.from('recibos').update(cobro).eq('id', id)
    expect(r2.error?.hint).toBe('sepa_por_remesa')
    const { data } = await serviceClient.from('recibos').select('estado').eq('id', id).single()
    expect(data?.estado).toBe('pendiente_procesar')
  })

  it('un borrador no se cobra a mano', async () => {
    const id = await recibo({ metodo: 'efectivo', estado: 'borrador' })
    const { error } = await cDirectora.from('recibos').update(cobro).eq('id', id)
    expect(error?.code).toBe('P0001')
    expect(error?.hint).toBe('no_cobrable_manual')
  })

  it('CHECK: sin forma o sin fecha no hay cobrado_manual, y la forma no puede ser SEPA', async () => {
    const id = await recibo({ metodo: 'efectivo' })
    const sinForma = await cDirectora
      .from('recibos')
      .update({ estado: 'cobrado_manual', cobro_fecha: '2026-01-20' })
      .eq('id', id)
    expect(sinForma.error?.code).toBe('23514')
    const sinFecha = await cDirectora
      .from('recibos')
      .update({ estado: 'cobrado_manual', cobro_forma: 'efectivo' })
      .eq('id', id)
    expect(sinFecha.error?.code).toBe('23514')
    const formaSepa = await cDirectora
      .from('recibos')
      .update({ ...cobro, cobro_forma: 'sepa' })
      .eq('id', id)
    expect(formaSepa.error?.code).toBe('23514')
    const notaSinCobro = await cDirectora.from('recibos').update({ cobro_nota: 'x' }).eq('id', id)
    expect(notaSinCobro.error?.code).toBe('23514')
  })

  it('la tutora no lo cobra: la RLS no le deja tocar la fila', async () => {
    const id = await recibo({ metodo: 'efectivo' })
    const { data, error } = await cTutora
      .from('recibos')
      .update(cobro)
      .eq('id', id)
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data).toBeNull()
    const { data: fila } = await serviceClient
      .from('recibos')
      .select('estado')
      .eq('id', id)
      .single()
    expect(fila?.estado).toBe('pendiente_procesar')
  })

  it('audit_log: el cobro deja la forma y la fecha, nunca la nota', async () => {
    const id = await recibo({ metodo: 'efectivo' })
    await cDirectora
      .from('recibos')
      .update({ ...cobro, cobro_nota: 'Nota que no se audita' })
      .eq('id', id)
    const { data } = await serviceClient
      .from('audit_log')
      .select('usuario_id, valores_despues')
      .eq('tabla', 'recibos')
      .eq('registro_id', id)
    const fila = (data ?? []).find(
      (a) => (a.valores_despues as Record<string, unknown> | null)?.estado === 'cobrado_manual'
    )
    expect(fila?.usuario_id).toBe(directora.id)
    const despues = fila!.valores_despues as Record<string, unknown>
    expect(despues.cobro_forma).toBe('efectivo')
    expect(despues.cobro_fecha).toBe('2026-01-20')
    expect(despues).not.toHaveProperty('cobro_nota')
    expect(JSON.stringify(data)).not.toContain('Nota que no se audita')
  })

  it('export del art. 15: la tutora recibe la forma, la fecha y la nota de su cobro', async () => {
    const id = await recibo({ metodo: 'efectivo', mes: 2, concepto_esporadico: 'Export PR-1a' })
    await cDirectora
      .from('recibos')
      .update({ ...cobro, cobro_forma: 'transferencia', cobro_nota: 'Nota del export' })
      .eq('id', id)
    const { data, error } = await cTutora.rpc('export_datos_sujeto', {
      p_sujeto_tipo: 'usuario',
      p_sujeto_id: tutora.id,
    })
    expect(error).toBeNull()
    const recibos = (
      (data as { cobros_familia: { recibos: Record<string, unknown>[] }[] }).cobros_familia ?? []
    ).flatMap((f) => f.recibos)
    const suyo = recibos.find((r) => r.concepto_esporadico === 'Export PR-1a')
    expect(suyo).toMatchObject({
      estado: 'cobrado_manual',
      cobro_forma: 'transferencia',
      cobro_fecha: '2026-01-20',
      cobro_nota: 'Nota del export',
    })
  })
})
