import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * R-5 — DESCONFIRMAR un recibo (confirmado → borrador) y su salvaguarda.
 *
 * Hasta aquí confirmar era irreversible: el trigger `congelar_si_mes_cerrado` rechazaba el
 * retroceso de plano ("recibo confirmado: no puede volver a borrador"). La decisión A de
 * Jose abre esa puerta, pero SOLO esa: un recibo que ya está en una remesa creada no se
 * toca, porque el fichero SEPA ha podido salir hacia el banco.
 *
 * Lo que fija esta suite:
 *   1. el ciclo completo — congelado → "Modificar" → editable → reconfirmar → congelado;
 *   2. la salvaguarda por REMESA, tanto por la RPC como por UPDATE directo (es invariante
 *      de BD, no una convención de la UI), y que una remesa BORRADA no bloquea;
 *   3. el corte por estado: un `cobrado_manual` (cobro fuera de SEPA, sin remesa de por
 *      medio) tampoco vuelve — el dinero ya entró;
 *   4. la reapertura del mes: confirmar el último borrador ancla `cierre_mensual` (R8), así
 *      que desconfirmar tiene que retirar el ancla o el panel se queda bloqueado sobre un
 *      mes que ya no está íntegramente procesado;
 *   5. que desconfirmar NO araña nada de lo que cuelga del recibo — líneas manuales de R-3,
 *      desborde de beca y transferencia siguen exactamente igual antes y después.
 *
 * NO se duplica aquí: la mecánica del motor y el congelado por estado (`f43-motor-recibos-
 * familia`), la preservación de manuales al regenerar (`r2-motor-preserva-manuales`) ni el
 * ciclo de generación de punta a punta (`r4-ciclo-completo-recibos`).
 *
 * Gateado: R5_MIGRATION_APPLIED=1 (requiere `20260828120000_phase_recibos_r5_desconfirmar`).
 */

const APPLIED = process.env.R5_MIGRATION_APPLIED === '1'

const ANIO = 2026
const MES = 9
const ESCOLARIDAD = 50000

async function insertarNino(centroId: string, familiaId: string, nombre: string): Promise<string> {
  const { data, error } = await serviceClient
    .from('ninos')
    .insert({
      centro_id: centroId,
      familia_id: familiaId,
      nombre,
      apellidos: 'Test',
      fecha_nacimiento: '2024-03-15',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`insertarNino: ${error?.message}`)
  return data.id
}

describe.skipIf(!APPLIED)('R-5 — desconfirmar un recibo', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let ajeno: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  let cAjeno: Awaited<ReturnType<typeof clientFor>>
  let conceptoId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro R5 desconfirmar')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin R5' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
    // Sin rol en este centro: la RPC es SECURITY DEFINER, así que la puerta es su es_admin().
    ajeno = await createTestUser({ nombre: 'Ajeno R5' })
    cAjeno = await clientFor(ajeno)

    const { data, error } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        nombre: 'R5 Escolaridad',
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        signo: 1,
        ambito: 'nino',
        importe_centimos: ESCOLARIDAD,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`concepto: ${error?.message}`)
    conceptoId = data.id
  })

  afterAll(async () => {
    // recibos_remesa va PRIMERO: su FK a recibos es ON DELETE RESTRICT.
    await serviceClient.from('recibos_remesa').delete().eq('centro_id', centro.id)
    await serviceClient.from('remesas').delete().eq('centro_id', centro.id)
    await serviceClient.from('beca_comedor_transferencia').delete().eq('centro_id', centro.id)
    await serviceClient.from('beca_comedor_desborde').delete().eq('centro_id', centro.id)
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(ajeno.id)
  })

  /** Una familia con un hijo, su concepto asignado y su recibo del mes ya generado. */
  async function familiaConRecibo(
    nombre: string
  ): Promise<{ familiaId: string; reciboId: string }> {
    const familiaId = await createTestFamilia(centro.id)
    const ninoId = await insertarNino(centro.id, familiaId, nombre)
    await matricular(ninoId, aula.id, curso.id)
    const { error: errAsig } = await serviceClient
      .from('asignacion_concepto')
      .insert({ centro_id: centro.id, concepto_id: conceptoId, nino_id: ninoId, origen: 'manual' })
    if (errAsig) throw new Error(`asignar: ${errAsig.message}`)

    const { error } = await cAdmin.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: MES,
    })
    if (error) throw new Error(`generar: ${error.message}`)

    const { data } = await serviceClient
      .from('recibos')
      .select('id')
      .eq('familia_id', familiaId)
      .eq('anio', ANIO)
      .eq('mes', MES)
      .eq('es_esporadico', false)
      .is('deleted_at', null)
      .single()
    return { familiaId, reciboId: data!.id }
  }

  async function estadoDe(reciboId: string): Promise<string> {
    const { data } = await serviceClient
      .from('recibos')
      .select('estado')
      .eq('id', reciboId)
      .single()
    return data!.estado
  }

  /** Mete el recibo en una remesa, como hace `crearRemesa` (remesa + enlace a la vez). */
  async function meterEnRemesa(reciboId: string, opts: { borrada?: boolean } = {}) {
    const { data: remesa, error } = await serviceClient
      .from('remesas')
      .insert({
        centro_id: centro.id,
        anio: ANIO,
        mes: MES,
        estado: 'borrador',
        deleted_at: opts.borrada ? new Date().toISOString() : null,
      })
      .select('id')
      .single()
    if (error || !remesa) throw new Error(`remesa: ${error?.message}`)
    const { error: errEnlace } = await serviceClient
      .from('recibos_remesa')
      .insert({ centro_id: centro.id, remesa_id: remesa.id, recibo_id: reciboId })
    if (errEnlace) throw new Error(`enlace: ${errEnlace.message}`)
  }

  it('el ciclo completo: congelado → Modificar → editable → reconfirmar → congelado', async () => {
    const { reciboId } = await familiaConRecibo('R5 Ciclo')
    const { data: linea } = await serviceClient
      .from('lineas_recibo')
      .select('id')
      .eq('recibo_id', reciboId)
      .limit(1)
      .single()

    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: reciboId })).error).toBeNull()
    expect(await estadoDe(reciboId)).toBe('pendiente_procesar')

    // Congelado: en caliente no se toca (esto es lo que "Modificar" viene a resolver).
    const enCaliente = await cAdmin
      .from('lineas_recibo')
      .update({ descripcion: 'en caliente' })
      .eq('id', linea!.id)
    expect(enCaliente.error?.code).toBe('P0001')

    // "Modificar".
    const desc = await cAdmin.rpc('desconfirmar_recibo', { p_recibo_id: reciboId })
    expect(desc.error).toBeNull()
    expect(await estadoDe(reciboId)).toBe('borrador')

    // Ahora sí: las herramientas de R-3 funcionan sin nada especial, porque es un borrador.
    const editar = await cAdmin
      .from('lineas_recibo')
      .update({
        descripcion: 'corregido a mano',
        precio_unitario_centimos: ESCOLARIDAD + 500,
        importe_centimos: ESCOLARIDAD + 500,
        origen: 'manual',
      })
      .eq('id', linea!.id)
    expect(editar.error).toBeNull()

    // Reconfirmar con la acción que ya existía.
    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: reciboId })).error).toBeNull()
    expect(await estadoDe(reciboId)).toBe('pendiente_procesar')

    const otraVez = await cAdmin
      .from('lineas_recibo')
      .update({ descripcion: 'segundo intento' })
      .eq('id', linea!.id)
    expect(otraVez.error?.code).toBe('P0001')

    const { data: final } = await serviceClient
      .from('lineas_recibo')
      .select('descripcion')
      .eq('id', linea!.id)
      .single()
    expect(final!.descripcion).toBe('corregido a mano')
  })

  it('reabre el mes: al desconfirmar cae el cierre, al reconfirmar se vuelve a anclar', async () => {
    const { reciboId } = await familiaConRecibo('R5 Cierre')

    // Se confirman TODOS los borradores del mes para que el cierre llegue a anclarse.
    const { data: pendientes } = await serviceClient
      .from('recibos')
      .select('id')
      .eq('centro_id', centro.id)
      .eq('anio', ANIO)
      .eq('mes', MES)
      .eq('estado', 'borrador')
    for (const r of pendientes ?? []) {
      await cAdmin.rpc('confirmar_recibo', { p_recibo_id: r.id })
    }
    const { data: cerrado } = await cAdmin.rpc('mes_cerrado', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: MES,
    })
    expect(cerrado, 'el mes debería haber quedado cerrado').toBe(true)

    // La RPC devuelve "el mes ha quedado REABIERTO", espejo del true de confirmar_recibo.
    const desc = await cAdmin.rpc('desconfirmar_recibo', { p_recibo_id: reciboId })
    expect(desc.error).toBeNull()
    expect(desc.data).toBe(true)

    const { data: trasDesc } = await cAdmin.rpc('mes_cerrado', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: MES,
    })
    expect(trasDesc, 'el mes sigue cerrado con un borrador dentro').toBe(false)

    const conf = await cAdmin.rpc('confirmar_recibo', { p_recibo_id: reciboId })
    expect(conf.data, 'reconfirmar debería volver a cerrar el mes').toBe(true)
  })

  it('SALVAGUARDA: un recibo en una remesa no se desconfirma, ni por la RPC ni a pelo', async () => {
    const { reciboId } = await familiaConRecibo('R5 Remesa')
    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: reciboId })).error).toBeNull()
    await meterEnRemesa(reciboId)

    expect((await cAdmin.rpc('recibo_en_remesa', { p_recibo_id: reciboId })).data).toBe(true)

    const porRpc = await cAdmin.rpc('desconfirmar_recibo', { p_recibo_id: reciboId })
    expect(porRpc.error?.code).toBe('P0001')
    expect(porRpc.error?.message).toContain('remesa')

    // La puerta de atrás: un UPDATE directo tampoco pasa. La salvaguarda vive en el trigger.
    const aPelo = await cAdmin
      .from('recibos')
      .update({ estado: 'borrador' })
      .eq('id', reciboId)
      .select('id')
    expect(aPelo.error?.code).toBe('P0001')

    expect(await estadoDe(reciboId)).toBe('pendiente_procesar')
  })

  it('una remesa BORRADA no bloquea: el enlace sobrevive pero ya no cuenta', async () => {
    const { reciboId } = await familiaConRecibo('R5 Remesa borrada')
    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: reciboId })).error).toBeNull()
    await meterEnRemesa(reciboId, { borrada: true })

    // `recibos_remesa` no tiene borrado lógico propio: el enlace sigue ahí.
    const { count } = await serviceClient
      .from('recibos_remesa')
      .select('id', { count: 'exact', head: true })
      .eq('recibo_id', reciboId)
    expect(count).toBe(1)

    expect((await cAdmin.rpc('recibo_en_remesa', { p_recibo_id: reciboId })).data).toBe(false)
    expect((await cAdmin.rpc('desconfirmar_recibo', { p_recibo_id: reciboId })).error).toBeNull()
    expect(await estadoDe(reciboId)).toBe('borrador')
  })

  it('un recibo ya COBRADO A MANO no vuelve a borrador (corte por estado, sin remesa de por medio)', async () => {
    const { reciboId } = await familiaConRecibo('R5 Cobrado')
    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: reciboId })).error).toBeNull()

    const cobrar = await cAdmin
      .from('recibos')
      .update({ estado: 'cobrado_manual', fecha_envio_banco: null, fecha_devolucion: null })
      .eq('id', reciboId)
    expect(cobrar.error).toBeNull()

    expect((await cAdmin.rpc('recibo_en_remesa', { p_recibo_id: reciboId })).data).toBe(false)
    const desc = await cAdmin.rpc('desconfirmar_recibo', { p_recibo_id: reciboId })
    expect(desc.error?.code).toBe('P0001')
    expect(await estadoDe(reciboId)).toBe('cobrado_manual')
  })

  it('no araña nada de lo que cuelga del recibo: manual, desborde y transferencia intactos', async () => {
    const { familiaId, reciboId } = await familiaConRecibo('R5 Colaterales')

    const { data: manual } = await serviceClient
      .from('lineas_recibo')
      .insert({
        centro_id: centro.id,
        recibo_id: reciboId,
        descripcion: 'Material a mano',
        cantidad: 1,
        precio_unitario_centimos: 7500,
        importe_centimos: 7500,
        origen: 'manual',
      })
      .select('id')
      .single()

    // Un desborde YA RESUELTO por transferencia: el caso con más cosas colgando del recibo.
    await serviceClient.from('beca_comedor_desborde').insert({
      centro_id: centro.id,
      recibo_id: reciboId,
      familia_id: familiaId,
      anio: ANIO,
      mes: MES,
      cuota_total_centimos: 10000,
      beca_total_centimos: 13000,
      exceso_centimos: 3000,
      estado: 'resuelto',
      via: 'transferencia',
    })
    await serviceClient.from('beca_comedor_transferencia').insert({
      centro_id: centro.id,
      recibo_id: reciboId,
      familia_id: familiaId,
      anio: ANIO,
      mes: MES,
      importe_centimos: 3000,
      estado: 'pendiente',
    })

    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: reciboId })).error).toBeNull()
    expect((await cAdmin.rpc('desconfirmar_recibo', { p_recibo_id: reciboId })).error).toBeNull()
    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: reciboId })).error).toBeNull()

    const { data: lineas } = await serviceClient
      .from('lineas_recibo')
      .select('id, origen, importe_centimos')
      .eq('recibo_id', reciboId)
    expect(lineas!.find((l) => l.id === manual!.id)).toMatchObject({
      origen: 'manual',
      importe_centimos: 7500,
    })

    const { data: desborde } = await serviceClient
      .from('beca_comedor_desborde')
      .select('estado, via, exceso_centimos')
      .eq('recibo_id', reciboId)
      .single()
    expect(desborde).toMatchObject({
      estado: 'resuelto',
      via: 'transferencia',
      exceso_centimos: 3000,
    })

    const { data: transferencia } = await serviceClient
      .from('beca_comedor_transferencia')
      .select('estado, importe_centimos')
      .eq('recibo_id', reciboId)
      .single()
    expect(transferencia).toMatchObject({ estado: 'pendiente', importe_centimos: 3000 })
  })

  it('idempotente sobre un borrador, y cerrada a quien no es admin del centro', async () => {
    const { reciboId } = await familiaConRecibo('R5 Guardas')

    // Ya es borrador: no revienta y no reabre nada.
    const yaBorrador = await cAdmin.rpc('desconfirmar_recibo', { p_recibo_id: reciboId })
    expect(yaBorrador.error).toBeNull()
    expect(yaBorrador.data).toBe(false)

    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: reciboId })).error).toBeNull()
    const ajenoIntenta = await cAjeno.rpc('desconfirmar_recibo', { p_recibo_id: reciboId })
    expect(ajenoIntenta.error?.code).toBe('42501')
    expect(await estadoDe(reciboId)).toBe('pendiente_procesar')
  })
})
