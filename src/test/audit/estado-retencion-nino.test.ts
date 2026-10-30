import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  anonClient,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from '../rls/setup'

/**
 * El cuadro de conservación del niño y la ficha médica bloqueada para la admin (PR-B2;
 * 20261211120000).
 *
 * `estado_retencion_nino` dice, dato por dato, qué pasa y cuándo, con los plazos que recibe: si
 * cambia un plazo, cambia la fecha. Una fecha pasada es un hecho (`vencido` si el dato sigue ahí,
 * `borrado` con la fecha de la purga); cuando no hay fecha, el motivo. Lo ve Dirección; el camino a
 * lo bloqueado, solo la admin.
 *
 * `ver_datos_bloqueados` entrega a la admin, con motivo, la ficha médica bloqueada del niño de baja,
 * solo para leer, y deja dos filas: en `accesos_datos_bloqueados` y en `lecturas_ficha_medica`.
 *
 * Las bajas son de 1996 y los plazos, de 20 o 50 años: las fechas no dependen del día en que corra
 * el test. El curso de ahora termina en 2099.
 */

const FICHA = {
  p_alergias_graves: 'Frutos secos',
  p_notas_emergencia: 'Llamar a la madre',
  p_medicacion_habitual: 'Ninguna',
  p_alergias_leves: '',
  p_medico_familia: 'Dra. Demo',
  p_telefono_emergencia: '600000000',
}

/** Plazos largos: todo en el futuro. */
const LARGOS = {
  p_anios_expediente: 50,
  p_anios_firmas: 50,
  p_anios_operativa: 50,
  p_anios_fiscal: 50,
  p_anios_cuenta: 50,
}

type Estado = Record<string, unknown> & {
  estado: string
  puede_ver_bloqueado?: boolean
  medicos?: Record<string, unknown>
  operativa?: Record<string, unknown>
  firmas?: Record<string, unknown>
  expediente?: Record<string, unknown>
  fiscal?: Record<string, unknown>
  cuentas?: Array<Record<string, unknown>>
}

describe('Estado de conservación del niño', () => {
  let centro: { id: string }
  let otroCentro: { id: string }
  let admin: TestUser
  let directora: TestUser
  let profe: TestUser
  let adminOtro: TestUser
  let superusuario: TestUser
  let tutor: TestUser
  /** De baja en 1996, con ficha, agenda y un hermano en su familia. */
  let viejo: string
  /** El hermano de `viejo`: activo hasta el test de la cuenta. */
  let hermano: string
  /** De baja hoy, solo en su familia. */
  let reciente: string
  /** De baja en 1996 y purgado. */
  let purgado: string
  /** Activo. */
  let activo: string

  async function estado(nino: string, quien: TestUser = admin, plazos = LARGOS) {
    const c = await clientFor(quien)
    return c.rpc('estado_retencion_nino', { p_nino_id: nino, ...plazos })
  }

  async function estadoOk(nino: string, quien: TestUser = admin, plazos = LARGOS): Promise<Estado> {
    const { data, error } = await estado(nino, quien, plazos)
    expect(error).toBeNull()
    return data as Estado
  }

  async function archivar(nino: string, fechaBaja: string, archivadoEn?: string) {
    const c = await clientFor(admin)
    const { error } = await c.rpc('archivar_nino', { p_nino_id: nino, p_fecha_baja: fechaBaja })
    expect(error).toBeNull()
    if (archivadoEn) {
      const { error: e2 } = await serviceClient
        .from('ninos')
        .update({ deleted_at: `${archivadoEn}T10:00:00+00:00` })
        .eq('id', nino)
      expect(e2).toBeNull()
    }
  }

  async function cuentas(
    tabla: 'lecturas_ficha_medica' | 'accesos_datos_bloqueados',
    nino: string
  ) {
    const q =
      tabla === 'lecturas_ficha_medica'
        ? serviceClient.from(tabla).select('id', { count: 'exact', head: true }).eq('nino_id', nino)
        : serviceClient
            .from(tabla)
            .select('id', { count: 'exact', head: true })
            .eq('sujeto_id', nino)
    const { count, error } = await q
    expect(error).toBeNull()
    return count ?? 0
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Estado Retencion')
    otroCentro = await createTestCentro('Centro Estado Retencion Otro')
    admin = await createTestUser({ nombre: 'Admin Estado Retencion' })
    directora = await createTestUser({ nombre: 'Directora Estado Retencion' })
    profe = await createTestUser({ nombre: 'Profe Estado Retencion' })
    adminOtro = await createTestUser({ nombre: 'Admin Otro Estado Retencion' })
    superusuario = await createTestUser({ nombre: 'Super Estado Retencion' })
    tutor = await createTestUser({ nombre: 'Tutor Estado Retencion' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(adminOtro.id, otroCentro.id, 'admin')
    const sp = await serviceClient.from('platform_admins').insert({ usuario_id: superusuario.id })
    expect(sp.error).toBeNull()

    const cursoViejo = (await createTestCurso(centro.id, 'cerrado')).id
    const r1 = await serviceClient
      .from('cursos_academicos')
      .update({ fecha_inicio: '1995-09-01', fecha_fin: '1996-07-31' })
      .eq('id', cursoViejo)
    expect(r1.error).toBeNull()
    const cursoActual = (await createTestCurso(centro.id)).id
    const r2 = await serviceClient
      .from('cursos_academicos')
      .update({ fecha_fin: '2099-07-31' })
      .eq('id', cursoActual)
    expect(r2.error).toBeNull()
    await createTestAula(centro.id, cursoActual)

    const v = await createTestNino(centro.id, 'Nino Estado Viejo')
    viejo = v.id
    const { data: h, error: hErr } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: v.familia_id,
        nombre: 'Nino Estado Hermano',
        apellidos: 'Apellido Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    expect(hErr).toBeNull()
    hermano = h!.id
    await crearFamiliaTutor(v.familia_id, tutor.id)
    await crearVinculo(viejo, tutor.id, 'tutor_legal_principal')
    await crearVinculo(hermano, tutor.id, 'tutor_legal_principal')

    reciente = (await createTestNino(centro.id, 'Nino Estado Reciente')).id
    purgado = (await createTestNino(centro.id, 'Nino Estado Purgado')).id
    activo = (await createTestNino(centro.id, 'Nino Estado Activo')).id

    const c = await clientFor(admin)
    for (const n of [viejo, reciente]) {
      const { error } = await c.rpc('set_info_medica_emergencia_cifrada', {
        p_nino_id: n,
        ...FICHA,
      })
      expect(error).toBeNull()
    }
    const { error: aErr } = await serviceClient
      .from('agendas_diarias')
      .insert({ nino_id: viejo, fecha: '1996-03-01', observaciones_generales: 'obs' })
    expect(aErr).toBeNull()

    await archivar(viejo, '1996-03-01', '1996-03-01')
    await archivar(purgado, '1996-03-01', '1996-03-01')
    await archivar(reciente, new Date().toISOString().slice(0, 10))

    const { error: pErr } = await serviceClient.rpc('purgar_expediente_nino', {
      p_nino_id: purgado,
      p_anios: 20,
    })
    expect(pErr).toBeNull()
    // La fecha de la purga, fija: a una hora en que el día UTC aún es el anterior al de Madrid.
    const { error: fErr } = await serviceClient
      .from('ninos')
      .update({ purgado_en: '2026-06-14T22:30:00Z' })
      .eq('id', purgado)
    expect(fErr).toBeNull()
  }, 120_000)

  afterAll(async () => {
    await serviceClient.from('platform_admins').delete().eq('usuario_id', superusuario.id)
    // Las filas que nombran a los usuarios del test: sin ellas no se pueden borrar.
    await serviceClient.from('accesos_datos_bloqueados').delete().eq('centro_id', centro.id)
    await serviceClient.from('lecturas_ficha_medica').delete().eq('centro_id', centro.id)
    await serviceClient.from('retenciones').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestCentro(otroCentro.id)
    for (const u of [admin, directora, profe, adminOtro, superusuario, tutor])
      await deleteTestUser(u.id)
  }, 120_000)

  it('premisa: de baja, purgado y activo como se montaron', async () => {
    const { data, error } = await serviceClient
      .from('ninos')
      .select('id, deleted_reason')
      .in('id', [viejo, hermano, reciente, purgado, activo])
    expect(error).toBeNull()
    const motivo = Object.fromEntries((data ?? []).map((n) => [n.id, n.deleted_reason]))
    expect(motivo[viejo]).toBe('baja_nino')
    expect(motivo[reciente]).toBe('baja_nino')
    expect(motivo[purgado]).toBe('purga_rgpd')
    expect(motivo[hermano]).toBeNull()
    expect(motivo[activo]).toBeNull()
  })

  it('el niño activo: ningún plazo corre', async () => {
    expect(await estadoOk(activo)).toEqual({ estado: 'activo' })
  })

  it('de baja hace años: ficha bloqueada, día a día por partes, expediente con su fecha', async () => {
    const e = await estadoOk(viejo)
    expect(e.estado).toBe('baja')
    expect(e.baja).toBe('1996-03-01')
    expect(e.medicos).toMatchObject({ estado: 'bloqueados', desde: '1996-08-01' })
    expect(e.medicos?.borrado).toEqual({ estado: 'se_borrara', hasta: '2046-03-02' })
    expect(e.expediente).toEqual({ estado: 'se_borrara', hasta: '2046-03-02' })
    // La agenda del 1 de marzo de 1996: curso que acaba el 31 de julio, más 50 años y un día.
    expect(e.operativa).toEqual({ estado: 'por_partes', hasta: '2046-08-01' })
    expect(e.firmas).toEqual({ estado: 'nada' })
  })

  it('las fechas salen de los plazos que recibe: con otros plazos, otras fechas', async () => {
    const e = await estadoOk(viejo, admin, {
      ...LARGOS,
      p_anios_expediente: 20,
      p_anios_operativa: 1,
    })
    // Vencidos y el dato sigue ahí: se dice como pendiente, no como borrado.
    expect(e.expediente).toEqual({ estado: 'vencido', hasta: '2016-03-02' })
    expect(e.operativa).toEqual({ estado: 'vencido', hasta: '1997-08-01' })
  })

  it('de baja hoy: la ficha aún a la vista, hasta el final del curso', async () => {
    const e = await estadoOk(reciente)
    expect(e.medicos).toMatchObject({ estado: 'a_la_vista', desde: '2099-08-01' })
    expect(e.operativa).toEqual({ estado: 'nada' })
    // Sin recibo pagado, lo fiscal cuenta desde el final del curso de la baja.
    expect(e.fiscal).toEqual({
      estado: 'a_la_vista',
      hasta: '2149-08-01',
      vencido: false,
      desde_pago: false,
    })
  })

  it('purgado: lo médico, el día a día y el expediente, borrados el día de la purga', async () => {
    const e = await estadoOk(purgado)
    expect(e.estado).toBe('purgado')
    expect(e.medicos).toEqual({ estado: 'borrados', desde: '2026-06-15' })
    expect(e.operativa).toEqual({ estado: 'borrado', desde: '2026-06-15' })
    expect(e.expediente).toEqual({ estado: 'borrado', desde: '2026-06-15' })
  })

  it('con un hermano en el centro: lo fiscal y la cuenta del tutor, sin fecha y diciendo por qué', async () => {
    const e = await estadoOk(viejo)
    expect(e.fiscal).toEqual({ estado: 'sin_fecha', motivos: ['otro_hijo'] })
    const cuenta = e.cuentas?.find((x) => x.usuario_id === tutor.id)
    expect(cuenta).toMatchObject({
      estado: 'sin_fecha',
      motivo: 'otro_hijo',
      baja_ultimo_hijo: null,
    })
  })

  it('retenido: el expediente no tiene fecha mientras dure', async () => {
    const c = await clientFor(admin)
    const poner = await c.rpc('poner_retencion', {
      p_centro_id: centro.id,
      p_sujetos: [{ tipo: 'nino', id: viejo }] as never,
      p_motivo_tipo: 'juzgado',
      p_motivo: 'Requerimiento del juzgado de prueba',
    })
    expect(poner.error).toBeNull()
    try {
      const e = await estadoOk(viejo)
      expect(e.retenido).toBe(true)
      expect(e.expediente).toEqual({ estado: 'sin_fecha', motivo: 'retenido' })
      expect(e.medicos?.borrado).toEqual({ estado: 'sin_fecha', motivo: 'retenido' })
      expect((e.fiscal?.motivos as string[]) ?? []).toContain('retenido')
    } finally {
      const quitar = await c.rpc('quitar_retencion', {
        p_centro_id: centro.id,
        p_sujetos: [{ tipo: 'nino', id: viejo }] as never,
        p_motivo: 'Fin del procedimiento de prueba',
      })
      expect(quitar.error).toBeNull()
    }
    expect((await estadoOk(viejo)).expediente).toEqual({
      estado: 'se_borrara',
      hasta: '2046-03-02',
    })
  })

  it('quién lo ve: Dirección sí, sin camino a lo bloqueado la directora; nadie más', async () => {
    expect((await estadoOk(viejo, admin)).puede_ver_bloqueado).toBe(true)
    expect((await estadoOk(viejo, directora)).puede_ver_bloqueado).toBe(false)
    // De baja hoy no hay nada bloqueado: tampoco la admin tiene camino.
    expect((await estadoOk(reciente, admin)).puede_ver_bloqueado).toBe(false)
    for (const quien of [profe, adminOtro, tutor]) {
      const { error } = await estado(viejo, quien)
      expect(error?.code).toBe('42501')
    }
    const { error: noExiste } = await estado('00000000-0000-4000-8000-000000000000', admin)
    expect(noExiste?.code).toBe('42501')
    const { error: anon } = await anonClient().rpc('estado_retencion_nino', {
      p_nino_id: viejo,
      ...LARGOS,
    })
    expect(anon).not.toBeNull()
    const { error: malo } = await estado(viejo, admin, { ...LARGOS, p_anios_cuenta: 0 })
    expect(malo?.code).toBe('22023')
  })

  it('la ficha bloqueada del niño de baja: la admin la lee con motivo y queda dos veces', async () => {
    const c = await clientFor(admin)
    // Premisa: con la sesión de siempre no se lee.
    const leer = await c.rpc('get_info_medica_emergencia', { p_nino_id: viejo, p_origen: 'ficha' })
    expect(leer.error?.code).toBe('55000')

    const lect = await cuentas('lecturas_ficha_medica', viejo)
    const acc = await cuentas('accesos_datos_bloqueados', viejo)

    const sinMotivo = await c.rpc('ver_datos_bloqueados', {
      p_centro_id: centro.id,
      p_sujeto_tipo: 'nino',
      p_sujeto_id: viejo,
      p_motivo_tipo: 'juzgado',
      p_motivo: 'corto',
    })
    expect(sinMotivo.error?.code).toBe('22023')
    expect(await cuentas('lecturas_ficha_medica', viejo)).toBe(lect)
    expect(await cuentas('accesos_datos_bloqueados', viejo)).toBe(acc)

    const { data, error } = await c.rpc('ver_datos_bloqueados', {
      p_centro_id: centro.id,
      p_sujeto_tipo: 'nino',
      p_sujeto_id: viejo,
      p_motivo_tipo: 'juzgado',
      p_motivo: 'Requerimiento del juzgado número 1 de prueba',
    })
    expect(error).toBeNull()
    const r = data as {
      bloqueado_desde: string
      apartados: { ficha_medica: Array<Record<string, string>> }
    }
    expect(r.bloqueado_desde).toBe('1996-08-01')
    expect(r.apartados.ficha_medica).toHaveLength(1)
    expect(r.apartados.ficha_medica[0]).toMatchObject({
      alergias_graves: 'Frutos secos',
      medico_familia: 'Dra. Demo',
    })

    expect(await cuentas('lecturas_ficha_medica', viejo)).toBe(lect + 1)
    expect(await cuentas('accesos_datos_bloqueados', viejo)).toBe(acc + 1)
    const { data: l } = await serviceClient
      .from('lecturas_ficha_medica')
      .select('origen, rol_lector, lector_id')
      .eq('nino_id', viejo)
      .order('leida_en', { ascending: false })
      .limit(1)
      .single()
    expect(l).toEqual({ origen: 'datos_bloqueados', rol_lector: 'admin', lector_id: admin.id })
    const { data: a } = await serviceClient
      .from('accesos_datos_bloqueados')
      .select('apartados, lector_id, motivo')
      .eq('sujeto_id', viejo)
      .order('leido_en', { ascending: false })
      .limit(1)
      .single()
    expect(a).toEqual({
      apartados: ['ficha_medica'],
      lector_id: admin.id,
      motivo: 'Requerimiento del juzgado número 1 de prueba',
    })

    // Solo para leer: la ficha sigue sin poder escribirse.
    const escribir = await c.rpc('set_info_medica_emergencia_cifrada', {
      p_nino_id: viejo,
      ...FICHA,
      p_alergias_graves: 'Otra cosa',
    })
    expect(escribir.error?.code).toBe('55000')
  })

  it('la ficha bloqueada no la abren la directora ni el superusuario, ni la de un niño que no está bloqueado', async () => {
    const motivo = {
      p_centro_id: centro.id,
      p_sujeto_tipo: 'nino',
      p_motivo_tipo: 'juzgado',
      p_motivo: 'Requerimiento del juzgado número 1 de prueba',
    }
    const lect = await cuentas('lecturas_ficha_medica', viejo)
    for (const quien of [directora, superusuario]) {
      const c = await clientFor(quien)
      const { error } = await c.rpc('ver_datos_bloqueados', { ...motivo, p_sujeto_id: viejo })
      expect(error?.code).toBe('42501')
    }
    expect(await cuentas('lecturas_ficha_medica', viejo)).toBe(lect)
    const c = await clientFor(admin)
    const { error } = await c.rpc('ver_datos_bloqueados', { ...motivo, p_sujeto_id: reciente })
    expect(error?.code).toBe('55000')
  })

  it('la lista de lo bloqueado incluye al niño de baja con la ficha bloqueada', async () => {
    const c = await clientFor(admin)
    const { data, error } = await c.rpc('sujetos_bloqueados', { p_centro_id: centro.id })
    expect(error).toBeNull()
    const ids = (data ?? []).map((s) => s.sujeto_id)
    expect(ids).toContain(viejo)
    expect(ids).toContain(purgado)
    expect(ids).not.toContain(reciente)
    expect((data ?? []).find((s) => s.sujeto_id === viejo)?.bloqueado_desde).toBe('1996-08-01')
  })

  // Va al final: da de baja al hermano.
  it('la cuenta del tutor cuenta desde la baja de su último hijo, y lo dice si no es la de este', async () => {
    await archivar(hermano, '2000-03-01', '2000-03-01')
    const e = await estadoOk(viejo)
    const cuenta = e.cuentas?.find((x) => x.usuario_id === tutor.id)
    expect(cuenta).toMatchObject({
      estado: 'se_borrara',
      hasta: '2050-03-02',
      baja_ultimo_hijo: '2000-03-01',
      por_otro_hijo: true,
      nombre: 'Tutor Estado Retencion',
    })
    // Desde la ficha del hermano, la misma fecha es la suya.
    const h = await estadoOk(hermano)
    expect(h.cuentas?.find((x) => x.usuario_id === tutor.id)).toMatchObject({
      estado: 'se_borrara',
      hasta: '2050-03-02',
      por_otro_hijo: false,
    })
  })
})
