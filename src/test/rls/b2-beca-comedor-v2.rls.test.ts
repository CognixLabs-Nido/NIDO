import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * B2-0 — RLS + constraints del modelo Beca comedor v2: `beca_comedor_elegibilidad`,
 * `beca_comedor_tramo`, `beca_comedor_desborde`, `beca_comedor_transferencia`.
 *
 * Cubre: RLS admin-only por centro (`es_admin`); coherencia de centro en el WITH CHECK
 * (`centro_de_nino` en elegibilidad/tramo, `centro_de_recibo` en desborde/transferencia);
 * UNIQUE elegibilidad (nino, curso) y UNIQUE PARCIAL tramo normal (nino, año_corr, mes_corr)
 * WHERE origen='normal' (un `resto` del mismo mes correspondiente SÍ se permite); CHECKs de
 * importe y de coherencia de estado; semántica RLS de UPDATE/DELETE de no-admin.
 *
 * BD compartida sin rollback entre `it` → cada test crea sus PROPIOS fixtures (niño/familia/
 * recibo por serviceClient) para no colisionar con las UNIQUE de otros tests.
 *
 * Gateado: BECA_COMEDOR_V2_APPLIED=1 (requiere phase_b2_0 aplicada en la BD de test).
 */

const APPLIED = process.env.BECA_COMEDOR_V2_APPLIED === '1'

describe.skipIf(!APPLIED)('B2 — beca comedor v2 RLS + constraints', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let admin: TestUser
  let profe: TestUser
  let tutor: TestUser
  let outsider: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  let cProfe: Awaited<ReturnType<typeof clientFor>>
  let cTutor: Awaited<ReturnType<typeof clientFor>>
  let cOutsider: Awaited<ReturnType<typeof clientFor>>

  async function nuevoNino(centroId: string): Promise<{ nino: string; familia: string }> {
    const familia = await createTestFamilia(centroId)
    const { data, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centroId,
        familia_id: familia,
        nombre: 'N',
        apellidos: 'T',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`nuevoNino: ${error?.message}`)
    return { nino: data.id, familia }
  }

  async function nuevoRecibo(centroId: string, familiaId: string): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centroId,
        familia_id: familiaId,
        anio: 2027,
        mes: 1,
        estado: 'borrador',
        total_centimos: 0,
        es_esporadico: false,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`nuevoRecibo: ${error?.message}`)
    return data.id
  }

  beforeAll(async () => {
    centroA = await createTestCentro('Centro B2 A')
    centroB = await createTestCentro('Centro B2 B')
    cursoA = await createTestCurso(centroA.id)
    admin = await createTestUser({ nombre: 'Admin B2' })
    profe = await createTestUser({ nombre: 'Profe B2' })
    tutor = await createTestUser({ nombre: 'Tutor B2' })
    outsider = await createTestUser({ nombre: 'Outsider B2' })
    await asignarRol(admin.id, centroA.id, 'admin')
    await asignarRol(profe.id, centroA.id, 'profe')
    await asignarRol(tutor.id, centroA.id, 'tutor_legal')
    cAdmin = await clientFor(admin)
    cProfe = await clientFor(profe)
    cTutor = await clientFor(tutor)
    cOutsider = await clientFor(outsider)
  })

  afterAll(async () => {
    for (const t of [
      'beca_comedor_transferencia',
      'beca_comedor_desborde',
      'beca_comedor_tramo',
      'beca_comedor_elegibilidad',
      'recibos',
    ] as const) {
      await serviceClient.from(t).delete().eq('centro_id', centroA.id)
      await serviceClient.from(t).delete().eq('centro_id', centroB.id)
    }
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(profe.id)
    await deleteTestUser(tutor.id)
    await deleteTestUser(outsider.id)
  })

  // ── Elegibilidad ────────────────────────────────────────────────────────────
  it('admin marca elegibilidad de su alumno; profe/tutor/outsider NO la ven', async () => {
    const { nino } = await nuevoNino(centroA.id)
    const { data, error } = await cAdmin
      .from('beca_comedor_elegibilidad')
      .insert({ centro_id: centroA.id, nino_id: nino, curso_academico_id: cursoA.id })
      .select('id')
      .single()
    expect(error).toBeNull()
    for (const c of [cProfe, cTutor, cOutsider]) {
      const { data: v } = await c.from('beca_comedor_elegibilidad').select('id').eq('id', data!.id)
      expect(v).toHaveLength(0)
    }
  })

  it('un no-admin (profe) NO puede marcar elegibilidad → 42501', async () => {
    const { nino } = await nuevoNino(centroA.id)
    const { error } = await cProfe
      .from('beca_comedor_elegibilidad')
      .insert({ centro_id: centroA.id, nino_id: nino, curso_academico_id: cursoA.id })
    expect(error?.code).toBe('42501')
  })

  it('cruce de centro: admin de A con un niño de B → 42501', async () => {
    const { nino: ninoB } = await nuevoNino(centroB.id)
    const { error } = await cAdmin
      .from('beca_comedor_elegibilidad')
      .insert({ centro_id: centroA.id, nino_id: ninoB, curso_academico_id: cursoA.id })
    expect(error?.code).toBe('42501')
  })

  it('UNIQUE elegibilidad (nino, curso) rechaza duplicado → 23505', async () => {
    const { nino } = await nuevoNino(centroA.id)
    await serviceClient
      .from('beca_comedor_elegibilidad')
      .insert({ centro_id: centroA.id, nino_id: nino, curso_academico_id: cursoA.id })
    const { error } = await cAdmin
      .from('beca_comedor_elegibilidad')
      .insert({ centro_id: centroA.id, nino_id: nino, curso_academico_id: cursoA.id })
    expect(error?.code).toBe('23505')
  })

  // ── Tramo (desacople + constraints) ──────────────────────────────────────────
  function tramo(
    nino: string,
    mesCorr: number,
    importe = 5000,
    extra: Record<string, unknown> = {}
  ) {
    return {
      centro_id: centroA.id,
      nino_id: nino,
      curso_academico_id: cursoA.id,
      anio_correspondiente: 2026,
      mes_correspondiente: mesCorr,
      anio_aplicacion: 2027,
      mes_aplicacion: 1,
      importe_centimos: importe,
      ...extra,
    }
  }

  it('admin crea un tramo desacoplado (corresp sep 2026 → aplic ene 2027)', async () => {
    const { nino } = await nuevoNino(centroA.id)
    const { data, error } = await cAdmin
      .from('beca_comedor_tramo')
      .insert(tramo(nino, 9))
      .select('estado, origen, mes_correspondiente, mes_aplicacion')
      .single()
    expect(error).toBeNull()
    expect(data?.estado).toBe('pendiente')
    expect(data?.origen).toBe('normal')
    expect(data?.mes_correspondiente).toBe(9)
    expect(data?.mes_aplicacion).toBe(1)
  })

  it('un no-admin (profe) NO puede crear tramo → 42501', async () => {
    const { nino } = await nuevoNino(centroA.id)
    const { error } = await cProfe.from('beca_comedor_tramo').insert(tramo(nino, 9))
    expect(error?.code).toBe('42501')
  })

  it('UNIQUE parcial: dos tramos NORMAL del mismo mes correspondiente → 23505', async () => {
    const { nino } = await nuevoNino(centroA.id)
    await serviceClient.from('beca_comedor_tramo').insert(tramo(nino, 10))
    const { error } = await cAdmin.from('beca_comedor_tramo').insert(tramo(nino, 10, 9999))
    expect(error?.code).toBe('23505')
  })

  it('un tramo RESTO del mismo mes correspondiente SÍ se permite (no colisiona con normal)', async () => {
    const { nino } = await nuevoNino(centroA.id)
    await serviceClient.from('beca_comedor_tramo').insert(tramo(nino, 11))
    const { error } = await cAdmin
      .from('beca_comedor_tramo')
      .insert(tramo(nino, 11, 1700, { origen: 'resto', mes_aplicacion: 2 }))
    expect(error).toBeNull()
  })

  it('CHECK importe_centimos > 0 rechaza 0 → 23514', async () => {
    const { nino } = await nuevoNino(centroA.id)
    const { error } = await cAdmin.from('beca_comedor_tramo').insert(tramo(nino, 12, 0))
    expect(error?.code).toBe('23514')
  })

  // ── Desborde + transferencia (coherencia por centro_de_recibo) ───────────────
  it('admin registra un desborde de su recibo; profe NO lo ve', async () => {
    const { familia } = await nuevoNino(centroA.id)
    const recibo = await nuevoRecibo(centroA.id, familia)
    const { data, error } = await cAdmin
      .from('beca_comedor_desborde')
      .insert({
        centro_id: centroA.id,
        recibo_id: recibo,
        familia_id: familia,
        anio: 2027,
        mes: 1,
        cuota_total_centimos: 3000,
        beca_total_centimos: 5000,
        exceso_centimos: 2000,
      })
      .select('id, estado')
      .single()
    expect(error).toBeNull()
    expect(data?.estado).toBe('pendiente')
    const { data: v } = await cProfe.from('beca_comedor_desborde').select('id').eq('id', data!.id)
    expect(v).toHaveLength(0)
  })

  it('cruce de recibo: admin de A con un recibo de B → 42501', async () => {
    const { familia: famA } = await nuevoNino(centroA.id)
    const { familia: famB } = await nuevoNino(centroB.id)
    const reciboB = await nuevoRecibo(centroB.id, famB)
    const { error } = await cAdmin.from('beca_comedor_desborde').insert({
      centro_id: centroA.id,
      recibo_id: reciboB,
      familia_id: famA,
      anio: 2027,
      mes: 1,
      cuota_total_centimos: 0,
      beca_total_centimos: 1,
      exceso_centimos: 1,
    })
    expect(error?.code).toBe('42501')
  })

  it('CHECK coherencia desborde: resuelto sin via → 23514', async () => {
    const { familia } = await nuevoNino(centroA.id)
    const recibo = await nuevoRecibo(centroA.id, familia)
    const { error } = await cAdmin.from('beca_comedor_desborde').insert({
      centro_id: centroA.id,
      recibo_id: recibo,
      familia_id: familia,
      anio: 2027,
      mes: 1,
      cuota_total_centimos: 3000,
      beca_total_centimos: 5000,
      exceso_centimos: 2000,
      estado: 'resuelto',
    })
    expect(error?.code).toBe('23514')
  })

  it('admin registra una transferencia (pendiente); profe NO la ve (D-P10)', async () => {
    const { familia } = await nuevoNino(centroA.id)
    const recibo = await nuevoRecibo(centroA.id, familia)
    const { data, error } = await cAdmin
      .from('beca_comedor_transferencia')
      .insert({
        centro_id: centroA.id,
        recibo_id: recibo,
        familia_id: familia,
        anio: 2027,
        mes: 1,
        importe_centimos: 2000,
      })
      .select('id, estado')
      .single()
    expect(error).toBeNull()
    expect(data?.estado).toBe('pendiente')
    const { data: v } = await cProfe
      .from('beca_comedor_transferencia')
      .select('id')
      .eq('id', data!.id)
    expect(v).toHaveLength(0)
  })

  it('CHECK coherencia transferencia: realizada sin fecha → 23514', async () => {
    const { familia } = await nuevoNino(centroA.id)
    const recibo = await nuevoRecibo(centroA.id, familia)
    const { error } = await cAdmin.from('beca_comedor_transferencia').insert({
      centro_id: centroA.id,
      recibo_id: recibo,
      familia_id: familia,
      anio: 2027,
      mes: 1,
      importe_centimos: 2000,
      estado: 'realizada',
    })
    expect(error?.code).toBe('23514')
  })

  // ── Semántica RLS de UPDATE/DELETE de no-admin ───────────────────────────────
  it('UPDATE/DELETE de no-admin no afecta filas; la elegibilidad sobrevive intacta', async () => {
    const { nino } = await nuevoNino(centroA.id)
    const { data: fila } = await serviceClient
      .from('beca_comedor_elegibilidad')
      .insert({ centro_id: centroA.id, nino_id: nino, curso_academico_id: cursoA.id })
      .select('id')
      .single()
    const id = fila!.id
    const upd = await cProfe
      .from('beca_comedor_elegibilidad')
      .update({ activa: false, fecha_baja: '2027-01-01' })
      .eq('id', id)
      .select('id')
    expect(upd.error).toBeNull()
    expect(upd.data ?? []).toHaveLength(0)
    const del = await cTutor.from('beca_comedor_elegibilidad').delete().eq('id', id).select('id')
    expect(del.error).toBeNull()
    expect(del.data ?? []).toHaveLength(0)
    const { data: sigue } = await serviceClient
      .from('beca_comedor_elegibilidad')
      .select('activa')
      .eq('id', id)
      .maybeSingle()
    expect(sigue?.activa).toBe(true)
  })
})
