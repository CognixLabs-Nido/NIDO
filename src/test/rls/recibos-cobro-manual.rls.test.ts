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
import { intentarConMarcador, insertarRecibos } from './remesa-como-sus-funciones'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * PR-1a (`20261105120000`) — cobrar a mano en efectivo o por transferencia.
 *
 *  - Un pendiente que no es SEPA se cobra a mano con su forma, su fecha y una nota. Desde
 *    `20261223120000` solo por `marcar_cobrado_manual`: el UPDATE directo lo para
 *    `recibos_dinero_solo_por_funcion` (`cobrado_por_funcion`), también con service_role.
 *  - Un SEPA pendiente no (va por remesa), ni un borrador: lo para el trigger
 *    `recibos_validar_cobro_manual`, también con service_role. Por fuera ya responde antes el
 *    trigger nuevo; el caso que separa las dos defensas pone el marcador de la función, y la de
 *    detrás tiene que seguir respondiendo con su HINT.
 *  - Sin forma o sin fecha no hay cobrado_manual (CHECK), y la forma nunca es SEPA (desde el
 *    PR-1b, `20261106120000`, también cheque, que va por su función: recibos-cobro-cheque). El
 *    CHECK también se mide con el marcador puesto, que es el único camino por el que se llega.
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
    const [id] = await insertarRecibos([
      {
        centro_id: centro.id,
        familia_id: familia,
        anio: 2026,
        mes: 1,
        estado: 'pendiente_procesar',
        total_centimos: 1000,
        es_esporadico: true,
        concepto_esporadico: 'Cobro manual PR-1a',
        ...over,
      },
    ])
    return id
  }

  const cobro = {
    estado: 'cobrado_manual' as const,
    cobro_forma: 'efectivo' as const,
    cobro_fecha: '2026-01-20',
  }

  /** El cobro como lo da la app: `marcar_cobrado_manual`. */
  function cobrar(
    c: SupabaseClient<Database>,
    id: string,
    forma: 'efectivo' | 'transferencia' = 'efectivo',
    nota = ''
  ) {
    return c.rpc('marcar_cobrado_manual', {
      p_recibo_id: id,
      p_forma: forma,
      p_fecha: cobro.cobro_fecha,
      p_nota: nota,
    })
  }

  /** El mismo cobro con el marcador de `marcar_cobrado_manual` puesto (el caso que separa). */
  const COBRO_SQL =
    "estado = 'cobrado_manual', cobro_forma = 'efectivo', cobro_fecha = '2026-01-20'"
  const conMarcador = (id: string, set = COBRO_SQL) =>
    intentarConMarcador(id, 'app.marcar_cobrado_manual', set)

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
    const { error } = await cobrar(cDirectora, id, 'efectivo', 'Pagado en secretaría')
    expect(error).toBeNull()
    const { data } = await serviceClient
      .from('recibos')
      .select('estado, cobro_forma, cobro_fecha, cobro_nota, fecha_envio_banco')
      .eq('id', id)
      .single()
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
    const { error } = await cobrar(cDirectora, id, 'transferencia')
    expect(error).toBeNull()
  })

  it('por fuera de su función no se cobra a mano, ni la directora ni service_role', async () => {
    const id = await recibo({ metodo: 'efectivo' })
    const r1 = await cDirectora.from('recibos').update(cobro).eq('id', id)
    expect(r1.error?.code).toBe('P0001')
    expect(r1.error?.hint).toBe('cobrado_por_funcion')
    const r2 = await serviceClient.from('recibos').update(cobro).eq('id', id)
    expect(r2.error?.hint).toBe('cobrado_por_funcion')
    const { data } = await serviceClient.from('recibos').select('estado').eq('id', id).single()
    expect(data?.estado).toBe('pendiente_procesar')
  })

  it('control del caso que separa: con el marcador de la función puesto, el cobro bueno pasa', async () => {
    // Sin esto, los rechazos de abajo podrían ser del instrumento y no de la defensa.
    const id = await recibo({ metodo: 'efectivo' })
    expect(conMarcador(id)).toEqual({ pasa: true, filas: 1 })
    const { data } = await serviceClient.from('recibos').select('estado').eq('id', id).single()
    expect(data?.estado, 'el intento se deshace siempre').toBe('pendiente_procesar')
  })

  it('un SEPA pendiente no: va por remesa (la función, y detrás el trigger aunque se salte)', async () => {
    const id = await recibo({ metodo: 'sepa' })
    const r1 = await cobrar(cDirectora, id)
    expect(r1.error?.code).toBe('P0001')
    expect(r1.error?.hint).toBe('sepa_por_remesa')
    expect(conMarcador(id)).toMatchObject({ pasa: false, code: 'P0001', hint: 'sepa_por_remesa' })
    const { data } = await serviceClient.from('recibos').select('estado').eq('id', id).single()
    expect(data?.estado).toBe('pendiente_procesar')
  })

  it('un borrador no se cobra a mano (la función, y detrás el trigger aunque se salte)', async () => {
    const id = await recibo({ metodo: 'efectivo', estado: 'borrador' })
    const { error } = await cobrar(cDirectora, id)
    expect(error?.code).toBe('P0001')
    expect(error?.hint).toBe('no_cobrable_manual')
    expect(conMarcador(id)).toMatchObject({
      pasa: false,
      code: 'P0001',
      hint: 'no_cobrable_manual',
    })
  })

  it('CHECK: sin forma o sin fecha no hay cobrado_manual, y la forma no puede ser SEPA', async () => {
    // Al CHECK solo se llega con el marcador puesto: por fuera responde antes el trigger nuevo.
    const id = await recibo({ metodo: 'efectivo' })
    const sinForma = conMarcador(id, "estado = 'cobrado_manual', cobro_fecha = '2026-01-20'")
    expect(sinForma).toMatchObject({ pasa: false, code: '23514' })
    expect(sinForma.pasa === false && sinForma.message).toContain('recibos_cobro_manual')
    const sinFecha = conMarcador(id, "estado = 'cobrado_manual', cobro_forma = 'efectivo'")
    expect(sinFecha).toMatchObject({ pasa: false, code: '23514' })
    const formaSepa = conMarcador(
      id,
      "estado = 'cobrado_manual', cobro_forma = 'sepa', cobro_fecha = '2026-01-20'"
    )
    expect(formaSepa).toMatchObject({ pasa: false, code: '23514' })
    // La nota sin cobro no cambia el estado: el trigger nuevo no entra, y el CHECK responde solo.
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
    expect((await cobrar(cDirectora, id, 'efectivo', 'Nota que no se audita')).error).toBeNull()
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
    expect((await cobrar(cDirectora, id, 'transferencia', 'Nota del export')).error).toBeNull()
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
