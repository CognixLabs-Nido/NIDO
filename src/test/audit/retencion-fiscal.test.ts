import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  crearFamiliaTutor,
  crearVinculo,
  createTestCentro,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from '../rls/setup'

/**
 * Lo fiscal al vencer (F11-B, punto 6, PR-8, tercera pieza; 20261208120000).
 *
 * La familia de Íñigo pagó su último recibo en 2019 (fechas ficticias): uno cobrado a mano y uno
 * devuelto, re-girado al banco dentro de una remesa que comparte con otra familia. Tiene un mandato
 * con su documento, el DNI de un segundo tutor sin cuenta, un borrador sin deuda dentro, parte de
 * servicio y una asignación. Íñigo está de baja desde 1990 y purgado.
 *
 * Espera a que la madre esté purgada; su cuenta vence con el borrador sin deuda (en lo que va por
 * plazo, «pendiente» es el dinero vivo). Frenan el dinero vivo (un pendiente con importe, una
 * devolución sin resolver o llevada a un borrador, dinero a favor sin devolver) y la retención; no
 * un pendiente de 0 €. Libre, se destruye entera, sin copia en audit_log, y la remesa compartida se
 * queda con lo de la otra familia. Sin ningún recibo pagado, cuenta el final del curso de la baja.
 * Al final, la cuenta de la madre: espera mientras algo la nombra, y después se borra.
 */

const MOTIVO = 'Requerimiento 12/2027 de la Agencia Tributaria'
const BAJA = '1990-01-01T10:00:00+00:00'
const ANIOS = 6

describe('Retención: lo fiscal al vencer', () => {
  let centro: { id: string }
  let admin: TestUser
  let madre: TestUser
  let inigo: string
  let familia: string
  let otra: string
  let bea: string
  let f2: string
  let dani: string
  let f3: string
  let remesa: string
  let reciboOtra: string
  let devueltoBanco: string
  let regiro: string
  let borrador: string
  const recibosF1: string[] = []
  let mandatoPath: string
  let dniPath: string

  async function vencidas(): Promise<string[]> {
    const { data, error } = await serviceClient.rpc('familias_fiscal_vencidas', { p_anios: ANIOS })
    expect(error).toBeNull()
    return (data ?? [])
      .filter((v) => v.centro_id === centro.id)
      .map((v) => v.familia_id)
      .sort()
  }

  async function cuenta(tabla: string, columna: string, valor: string): Promise<number> {
    const { count, error } = await serviceClient
      .from(tabla as never)
      .select('id', { count: 'exact', head: true })
      .eq(columna, valor)
    expect(error).toBeNull()
    return count ?? 0
  }

  async function retener(tipo: 'nino' | 'usuario', id: string) {
    const c = await clientFor(admin)
    const r = await c.rpc('poner_retencion', {
      p_centro_id: centro.id,
      p_sujetos: [{ tipo, id }] as never,
      p_motivo_tipo: 'agencia_tributaria',
      p_motivo: MOTIVO,
    })
    expect(r.error).toBeNull()
  }

  async function soltar(tipo: 'nino' | 'usuario', id: string) {
    const c = await clientFor(admin)
    const r = await c.rpc('quitar_retencion', {
      p_centro_id: centro.id,
      p_sujetos: [{ tipo, id }] as never,
      p_motivo: 'Archivado el requerimiento',
    })
    expect(r.error).toBeNull()
  }

  async function recibo(familiaId: string, fila: Record<string, unknown>): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({ centro_id: centro.id, familia_id: familiaId, anio: 2024, ...fila } as never)
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    return (data as { id: string }).id
  }

  async function resolver(id: string, salida: string, fecha: string | null = null) {
    const c = await clientFor(admin)
    return c.rpc('resolver_devolucion', {
      p_recibo_id: id,
      p_salida: salida,
      p_fecha: fecha as string,
      p_nota: null as unknown as string,
    })
  }

  /** Enviado al banco en 2019 y devuelto por Dirección (el camino real). */
  async function devuelto(mes: number): Promise<string> {
    const id = await recibo(familia, {
      mes,
      metodo: 'sepa',
      estado: 'enviado_banco',
      fecha_envio_banco: '2019-09-05',
      total_centimos: 10000,
    })
    const c = await clientFor(admin)
    const { error } = await c
      .from('recibos')
      .update({
        estado: 'devuelto',
        fecha_devolucion: '2019-09-20',
        devolucion_gastos_centimos: 300,
      })
      .eq('id', id)
      .select('id')
      .single()
    if (error) throw new Error(`devolver: ${error.message}`)
    recibosF1.push(id)
    return id
  }

  async function bajaYPurga(nino: string, baja: string, anios: number) {
    const b = await serviceClient
      .from('ninos')
      .update({ deleted_at: baja, deleted_reason: 'baja_nino' })
      .eq('id', nino)
    expect(b.error).toBeNull()
    const p = await serviceClient.rpc('purgar_expediente_nino', { p_nino_id: nino, p_anios: anios })
    expect(p.error).toBeNull()
    expect(p.data).toBe(true)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Retencion Fiscal')
    admin = await createTestUser({ nombre: 'Admin Retencion Fiscal' })
    madre = await createTestUser({ nombre: 'Madre Retencion Fiscal' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(madre.id, centro.id, 'tutor_legal')
    const cursos = await serviceClient.from('cursos_academicos').insert([
      {
        centro_id: centro.id,
        nombre: '1989-1990',
        fecha_inicio: '1989-09-01',
        fecha_fin: '1990-07-31',
        estado: 'cerrado' as const,
      },
      {
        centro_id: centro.id,
        nombre: '2023-2024',
        fecha_inicio: '2023-09-01',
        fecha_fin: '2024-07-31',
        estado: 'cerrado' as const,
      },
    ])
    expect(cursos.error).toBeNull()

    const a = await createTestNino(centro.id, 'Íñigo')
    inigo = a.id
    familia = a.familia_id
    await crearFamiliaTutor(familia, madre.id, 'titular')
    await crearVinculo(inigo, madre.id, 'tutor_legal_principal')
    dniPath = `${centro.id}/${inigo}/dni-segundo.pdf`
    const ft = await serviceClient.from('familia_tutores').insert({
      familia_id: familia,
      usuario_id: null,
      rol_familia: 'segundo_tutor',
      nombre_completo: 'Segundo Tutor Sin Cuenta',
      dni_documento_path: dniPath,
    })
    expect(ft.error).toBeNull()
    mandatoPath = `${centro.id}/familia/${familia}/mandato.pdf`
    const m = await serviceClient.from('mandatos_sepa').insert({
      centro_id: centro.id,
      familia_id: familia,
      nino_id: inigo,
      usuario_id: madre.id,
      iban_cifrado: '\\x00',
      iban_ultimos4: '1234',
      titular: 'Titular Retencion Fiscal',
      identificador_mandato: `NIDO-FISCAL-${centro.id.slice(0, 8)}`,
      estado: 'activo',
      documento_path: mandatoPath,
    })
    expect(m.error).toBeNull()

    const { data: concepto, error: cErr } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        nombre: 'Material Fiscal',
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        importe_centimos: 1500,
        ambito: 'nino',
        aplicacion: 'manual',
      })
      .select('id')
      .single()
    expect(cErr).toBeNull()
    const asig = await serviceClient.from('asignacion_concepto').insert({
      centro_id: centro.id,
      concepto_id: concepto!.id,
      nino_id: inigo,
      origen: 'manual',
    })
    expect(asig.error).toBeNull()
    const parte = await serviceClient.from('parte_servicio_diario').insert({
      centro_id: centro.id,
      nino_id: inigo,
      fecha: '1989-10-02',
      servicio: 'comedor',
    })
    expect(parte.error).toBeNull()

    // Los recibos: uno cobrado a mano, uno devuelto y re-girado al banco, y un borrador sin deuda.
    recibosF1.push(
      await recibo(familia, {
        mes: 1,
        estado: 'cobrado_manual',
        cobro_forma: 'efectivo',
        cobro_fecha: '2019-09-01',
        total_centimos: 10000,
      })
    )
    devueltoBanco = await devuelto(2)
    const rg = await resolver(devueltoBanco, 'banco')
    expect(rg.error).toBeNull()
    regiro = rg.data as string
    recibosF1.push(regiro)
    borrador = await recibo(familia, { mes: 6, estado: 'borrador', total_centimos: 5000 })
    recibosF1.push(borrador)
    const lb = await serviceClient.from('lineas_recibo').insert({
      centro_id: centro.id,
      recibo_id: borrador,
      nino_id: inigo,
      descripcion: 'Comedor Íñigo',
      cantidad: 1,
      precio_unitario_centimos: 5000,
      importe_centimos: 5000,
    })
    expect(lb.error).toBeNull()

    // La remesa del re-giro, compartida con otra familia.
    otra = (await createTestNino(centro.id, 'Otra')).familia_id
    reciboOtra = await recibo(otra, {
      mes: 2,
      metodo: 'sepa',
      estado: 'pendiente_procesar',
      total_centimos: 8000,
    })
    const { data: rem, error: remErr } = await serviceClient
      .from('remesas')
      .insert({ centro_id: centro.id, anio: 2024, mes: 2 })
      .select('id')
      .single()
    expect(remErr).toBeNull()
    remesa = rem!.id
    const enl = await serviceClient.from('recibos_remesa').insert([
      { remesa_id: remesa, recibo_id: regiro, centro_id: centro.id },
      { remesa_id: remesa, recibo_id: reciboOtra, centro_id: centro.id },
    ])
    expect(enl.error).toBeNull()
    const env = await serviceClient
      .from('recibos')
      .update({ estado: 'enviado_banco', fecha_envio_banco: '2019-10-01' })
      .eq('id', regiro)
    expect(env.error).toBeNull()

    await bajaYPurga(inigo, BAJA, 5)

    // Sin ningún recibo pagado: Bea, de baja en 1990; Dani, de baja en 2024.
    const b = await createTestNino(centro.id, 'Bea')
    bea = b.id
    f2 = b.familia_id
    await bajaYPurga(bea, BAJA, 5)
    const d = await createTestNino(centro.id, 'Dani')
    dani = d.id
    f3 = d.familia_id
    await bajaYPurga(dani, '2024-06-01T10:00:00+00:00', 1)
  })

  afterAll(async () => {
    await serviceClient.from('retenciones').delete().eq('centro_id', centro.id)
    await serviceClient.from('olvido_solicitudes').delete().eq('centro_id', centro.id)
    await serviceClient.from('audit_log').delete().eq('tabla', 'ensayo_fiscal')
    await serviceClient.from('recibos_remesa').delete().eq('centro_id', centro.id)
    await serviceClient.from('remesas').delete().eq('centro_id', centro.id)
    await serviceClient.from('beca_comedor_transferencia').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await serviceClient.from('parte_servicio_diario').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    for (const u of [admin, madre]) await deleteTestUser(u.id)
  })

  it('premisa: Íñigo, Bea y Dani purgados; la madre sin purgar; la familia de Íñigo espera', async () => {
    for (const n of [inigo, bea, dani]) {
      const { data } = await serviceClient
        .from('ninos')
        .select('deleted_reason')
        .eq('id', n)
        .single()
      expect(data?.deleted_reason).toBe('purga_rgpd')
    }
    expect(await cuenta('recibos', 'familia_id', familia)).toBe(4)
    expect(await cuenta('recibos_remesa', 'remesa_id', remesa)).toBe(2)
    expect(await vencidas()).toEqual([f2])
  })

  it('las funciones del cron no las abre nadie con sesión, tampoco la titular', async () => {
    for (const u of [admin, madre]) {
      const c = await clientFor(u)
      for (const r of [
        await c.rpc('familias_fiscal_vencidas', { p_anios: ANIOS }),
        await c.rpc('destruir_fiscal_familia', { p_familia_id: f2, p_anios: ANIOS }),
        await c.rpc('destruir_cuentas_olvidadas', { p_simular: true }),
        await c.rpc('cuentas_auth_huerfanas'),
      ]) {
        expect(r.error?.code).toBe('42501')
      }
    }
    expect(await vencidas()).toEqual([f2])
  })

  it('la cuenta de la madre vence con el borrador sin deuda, y purgada, la familia ya está', async () => {
    const { data: cv, error } = await serviceClient.rpc('cuentas_vencidas', { p_anios: 5 })
    expect(error).toBeNull()
    expect((cv ?? []).filter((v) => v.centro_id === centro.id).map((v) => v.usuario_id)).toEqual([
      madre.id,
    ])
    const a = await serviceClient.rpc('abrir_purga_cuenta', {
      p_usuario_id: madre.id,
      p_centro_id: centro.id,
      p_anios: 5,
    })
    expect(a.error).toBeNull()
    const p = await serviceClient.rpc('purgar_sujeto_db', { p_solicitud_id: a.data as string })
    expect(p.error).toBeNull()
    expect(await vencidas()).toEqual([familia, f2].sort())
  })

  it('las rutas de sus documentos salen con ella, para borrarlas antes', async () => {
    const { data } = await serviceClient.rpc('familias_fiscal_vencidas', { p_anios: ANIOS })
    const f = (data ?? []).find((v) => v.familia_id === familia)
    expect(f?.mandatos).toEqual([mandatoPath])
    expect(f?.dnis).toEqual([dniPath])
  })

  it('el dinero vivo frena; un pendiente de 0 € no', async () => {
    // Un pendiente con importe que cobrar.
    const pend = await recibo(familia, {
      mes: 7,
      metodo: 'efectivo',
      estado: 'pendiente_procesar',
      total_centimos: 2000,
    })
    recibosF1.push(pend)
    expect(await vencidas()).toEqual([f2])
    const pc = await serviceClient
      .from('recibos')
      .update({ estado: 'cobrado_manual', cobro_forma: 'efectivo', cobro_fecha: '2019-09-02' })
      .eq('id', pend)
    expect(pc.error).toBeNull()
    expect(await vencidas()).toEqual([familia, f2].sort())

    // Uno de 0 €: no hay nada que cobrar, y no sale nunca de pendiente.
    recibosF1.push(
      await recibo(familia, {
        mes: 8,
        metodo: 'sepa',
        estado: 'pendiente_procesar',
        total_centimos: 0,
      })
    )
    expect(await vencidas()).toEqual([familia, f2].sort())

    // Una devolución sin resolver; llevada a un borrador (la deuda dentro); vuelta a abrir al quitar
    // la línea; cobrada en efectivo, ya no.
    const dev = await devuelto(9)
    expect(await vencidas()).toEqual([f2])
    const sig = await resolver(dev, 'siguiente_recibo')
    expect(sig.error).toBeNull()
    const { data: arr } = await serviceClient
      .from('lineas_recibo')
      .select('id, recibo_id')
      .eq('arrastre_de_recibo_id', dev)
      .single()
    recibosF1.push(arr!.recibo_id)
    expect(await vencidas()).toEqual([f2])
    const q = await serviceClient.from('lineas_recibo').delete().eq('id', arr!.id)
    expect(q.error).toBeNull()
    expect(await vencidas()).toEqual([f2])
    const ef = await resolver(dev, 'efectivo', '2019-09-25')
    expect(ef.error).toBeNull()
    expect(await vencidas()).toEqual([familia, f2].sort())

    // Dinero a favor de la familia sin devolver.
    const { data: tr, error: trErr } = await serviceClient
      .from('beca_comedor_transferencia')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        anio: 2024,
        mes: 3,
        importe_centimos: 700,
      })
      .select('id')
      .single()
    expect(trErr).toBeNull()
    expect(await vencidas()).toEqual([f2])
    const hecha = await serviceClient
      .from('beca_comedor_transferencia')
      .update({ estado: 'realizada', realizada_at: new Date().toISOString() })
      .eq('id', tr!.id)
    expect(hecha.error).toBeNull()
    expect(await vencidas()).toEqual([familia, f2].sort())
  })

  it('la retención: Íñigo o la madre retenidos hacen esperar a la familia', async () => {
    await retener('nino', inigo)
    expect(await vencidas()).toEqual([f2])
    const { data } = await serviceClient.rpc('destruir_fiscal_familia', {
      p_familia_id: familia,
      p_anios: ANIOS,
    })
    expect(data).toBeNull()
    await soltar('nino', inigo)
    await retener('usuario', madre.id)
    expect(await vencidas()).toEqual([f2])
    await soltar('usuario', madre.id)
    expect(await vencidas()).toEqual([familia, f2].sort())
  })

  it('libre: se destruye entera, sin copia; la remesa se queda con lo de la otra familia', async () => {
    const { data, error } = await serviceClient.rpc('destruir_fiscal_familia', {
      p_familia_id: familia,
      p_anios: ANIOS,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({
      recibos: recibosF1.length,
      recibos_remesa: 1,
      remesas: 0,
      mandatos_sepa: 1,
      asignacion_concepto: 1,
      parte_servicio_diario: 1,
      beca_comedor_transferencia: 1,
      ninos: 1,
      familia_tutores: 2,
      familias: 1,
    })
    expect(await cuenta('recibos', 'familia_id', familia)).toBe(0)
    expect(await cuenta('familias', 'id', familia)).toBe(0)
    expect(await cuenta('ninos', 'id', inigo)).toBe(0)
    expect(await cuenta('mandatos_sepa', 'familia_id', familia)).toBe(0)
    expect(await cuenta('remesas', 'id', remesa)).toBe(1)
    expect(await cuenta('recibos_remesa', 'recibo_id', reciboOtra)).toBe(1)
    expect(await cuenta('recibos', 'id', reciboOtra)).toBe(1)

    const { count } = await serviceClient
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .in('registro_id', [...recibosF1, inigo, familia])
    expect(count).toBe(0)
    expect(await vencidas()).toEqual([f2])
  })

  it('sin ningún recibo pagado: cuenta el final del curso de la baja', async () => {
    expect(
      await serviceClient.rpc('destruir_fiscal_familia', { p_familia_id: f3, p_anios: ANIOS })
    ).toMatchObject({ data: null, error: null })
    expect(await cuenta('familias', 'id', f3)).toBe(1)
    const { data, error } = await serviceClient.rpc('destruir_fiscal_familia', {
      p_familia_id: f2,
      p_anios: ANIOS,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ ninos: 1, familias: 1, recibos: 0 })
    expect(await cuenta('ninos', 'id', bea)).toBe(0)
    expect(await vencidas()).toEqual([])
  })

  it('la cuenta de la madre: espera mientras algo la nombra; después se borra, y Auth la encuentra', async () => {
    const sim = await serviceClient.rpc('destruir_cuentas_olvidadas', { p_simular: true })
    expect(sim.error).toBeNull()
    expect((sim.data as { candidatas: number }).candidatas).toBeGreaterThanOrEqual(1)

    // Su actividad en audit_log la nombra todavía.
    const al = await serviceClient.from('audit_log').insert({
      tabla: 'ensayo_fiscal',
      accion: 'INSERT',
      usuario_id: madre.id,
      centro_id: centro.id,
    })
    expect(al.error).toBeNull()
    const espera = await serviceClient.rpc('destruir_cuentas_olvidadas', { p_simular: false })
    expect(espera.error).toBeNull()
    expect((espera.data as { borradas: string[] }).borradas).not.toContain(madre.id)
    expect((espera.data as { esperan: number }).esperan).toBeGreaterThanOrEqual(1)
    expect(await cuenta('usuarios', 'id', madre.id)).toBe(1)

    const q = await serviceClient.from('audit_log').delete().eq('tabla', 'ensayo_fiscal')
    expect(q.error).toBeNull()
    const real = await serviceClient.rpc('destruir_cuentas_olvidadas', { p_simular: false })
    expect(real.error).toBeNull()
    expect((real.data as { borradas: string[] }).borradas).toContain(madre.id)
    expect(await cuenta('usuarios', 'id', madre.id)).toBe(0)

    // Con el email que le deja la purga de la app, Auth la lista para la Admin API.
    const up = await serviceClient.auth.admin.updateUserById(madre.id, {
      email: `borrado+${madre.id}@borrado.invalid`,
    })
    expect(up.error).toBeNull()
    const h = await serviceClient.rpc('cuentas_auth_huerfanas')
    expect(h.error).toBeNull()
    expect(h.data).toContain(madre.id)
    expect(h.data).not.toContain(admin.id)
  })
})
