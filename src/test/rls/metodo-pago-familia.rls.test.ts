import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
 * PR-7 — el método de pago va en la FICHA de la familia (`familias.metodo_pago`).
 *
 *  - Una familia nueva nace en efectivo; el primer mandato SEPA (el paso del alta) la pasa a sepa.
 *    El reintento del alta y el cambio de cuenta no tocan lo que haya elegido la directora.
 *  - Al generar, el recibo coge el de la ficha, salvo que su mes tenga una excepción
 *    (`metodo_pago_familia`, el selector de la lista de recibos), que vale solo ese mes.
 *  - Solo Dirección cambia la ficha, y el tutor ve el método de su familia en su export (art. 15).
 */

const ANIO = 2026
const IBAN = 'ES9121000418450200051332'
const IBAN_OTRO = 'ES7921000813610123456789'

function mandato(familiaId: string, iban: string, id: string) {
  return {
    p_familia_id: familiaId,
    p_nino_id: null,
    p_iban: iban,
    p_titular: 'Titular PR7',
    p_identificador_mandato: id,
    p_documento_path: null,
    p_firma_imagen: '',
    p_nombre_tecleado: 'Titular PR7',
    p_texto_hash: null,
    p_ip_address: null,
    p_user_agent: null,
    p_fecha_firma: '2026-02-01T10:00:00Z',
    p_metodo: 'presencial',
  } as never
}

describe('PR-7 — el método de pago va en la ficha de la familia', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let profe: TestUser
  let tutor: TestUser
  let familia: string
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  let cProfe: Awaited<ReturnType<typeof clientFor>>
  let cTutor: Awaited<ReturnType<typeof clientFor>>

  async function metodoFicha(): Promise<string | undefined> {
    const { data } = await serviceClient
      .from('familias')
      .select('metodo_pago')
      .eq('id', familia)
      .single()
    return data?.metodo_pago
  }

  async function generarYMetodo(mes: number): Promise<string | null | undefined> {
    const { error } = await cAdmin.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: mes,
    })
    expect(error).toBeNull()
    const { data } = await serviceClient
      .from('recibos')
      .select('metodo')
      .eq('familia_id', familia)
      .eq('anio', ANIO)
      .eq('mes', mes)
      .eq('es_esporadico', false)
      .is('deleted_at', null)
      .maybeSingle()
    return data?.metodo
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Metodo Pago PR7')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Metodo PR7' })
    profe = await createTestUser({ nombre: 'Profe Metodo PR7' })
    tutor = await createTestUser({ nombre: 'Tutor Metodo PR7' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    familia = await createTestFamilia(centro.id)
    await crearFamiliaTutor(familia, tutor.id, 'titular')

    const { data: nino, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        nombre: 'Nino PR7',
        apellidos: 'Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (error || !nino) throw new Error(`nino: ${error?.message}`)
    await matricular(nino.id, aula.id, curso.id)
    const { data: cuota } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        nombre: 'Cuota PR7',
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        signo: 1,
        ambito: 'nino',
        importe_centimos: 29000,
      })
      .select('id')
      .single()
    await serviceClient
      .from('asignacion_concepto')
      .insert({ centro_id: centro.id, concepto_id: cuota!.id, nino_id: nino.id, origen: 'manual' })

    cAdmin = await clientFor(admin)
    cProfe = await clientFor(profe)
    cTutor = await clientFor(tutor)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('metodo_pago_familia').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(profe.id)
    await deleteTestUser(tutor.id)
  }, 60_000)

  it('una familia nueva nace en efectivo, y su recibo lo coge (sin mandato, sin elegir nada)', async () => {
    expect(await metodoFicha()).toBe('efectivo')
    expect(await generarYMetodo(1)).toBe('efectivo')
  })

  it('el primer mandato SEPA (el paso del alta) la pasa a sepa', async () => {
    const { error } = await cTutor.rpc('registrar_mandato_sepa', mandato(familia, IBAN, 'PR7-1'))
    expect(error).toBeNull()
    expect(await metodoFicha()).toBe('sepa')
    expect(await generarYMetodo(2)).toBe('sepa')
  })

  it('la ficha manda mes tras mes; la excepción de un mes vale solo ese mes', async () => {
    const r = await cAdmin
      .from('familias')
      .update({ metodo_pago: 'cheque_guarderia' })
      .eq('id', familia)
      .select('id')
    expect(r.error).toBeNull()
    expect(r.data).toHaveLength(1)

    const exc = await cAdmin
      .from('metodo_pago_familia')
      .insert({ centro_id: centro.id, familia_id: familia, anio: ANIO, mes: 4, metodo: 'efectivo' })
    expect(exc.error).toBeNull()

    expect(await generarYMetodo(3)).toBe('cheque_guarderia')
    expect(await generarYMetodo(4)).toBe('efectivo')
    expect(await generarYMetodo(5)).toBe('cheque_guarderia')
  })

  it('el reintento del alta y el cambio de cuenta no tocan lo que eligió la directora', async () => {
    expect(await metodoFicha()).toBe('cheque_guarderia')
    const reintento = await cTutor.rpc('registrar_mandato_sepa', mandato(familia, IBAN, 'PR7-1'))
    expect(reintento.error).toBeNull()
    expect(await metodoFicha()).toBe('cheque_guarderia')
    const sustituir = await cAdmin.rpc(
      'sustituir_mandato_sepa',
      mandato(familia, IBAN_OTRO, 'PR7-2')
    )
    expect(sustituir.error).toBeNull()
    expect(await metodoFicha()).toBe('cheque_guarderia')
  })

  it('ni la profe ni el tutor cambian la ficha: la RLS no les deja ver la fila', async () => {
    for (const c of [cProfe, cTutor]) {
      const r = await c
        .from('familias')
        .update({ metodo_pago: 'transferencia' })
        .eq('id', familia)
        .select('id')
      expect(r.data ?? []).toHaveLength(0)
    }
    expect(await metodoFicha()).toBe('cheque_guarderia')
  })

  it('el tutor ve el método de su familia en su export (art. 15)', async () => {
    const { data, error } = await cTutor.rpc('export_datos_sujeto', {
      p_sujeto_tipo: 'usuario',
      p_sujeto_id: tutor.id,
    })
    expect(error).toBeNull()
    const cobros = (data as { cobros_familia?: Array<Record<string, unknown>> }).cobros_familia
    expect(cobros).toHaveLength(1)
    expect(cobros?.[0]?.metodo_pago).toBe('cheque_guarderia')
  })
})
