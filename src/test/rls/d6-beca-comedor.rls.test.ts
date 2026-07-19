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

/**
 * D-6-4 — RLS + constraints de `beca_comedor_mes` (D-6-1 / D-6-1c).
 *
 * Cubre:
 *  - RLS admin-only por centro (SELECT/INSERT/UPDATE/DELETE vía `es_admin(centro_id)`):
 *    outsider, profe y tutor NO ven ni escriben; el admin del centro sí.
 *  - Coherencia centro↔niño (D-6-1c, `centro_de_nino(nino_id) = centro_id` en el WITH CHECK
 *    de INSERT y UPDATE): un admin del centro A no puede registrar/mover una beca hacia un
 *    niño de otro centro.
 *  - CHECK `importe > 0` (23514), CHECK `mes BETWEEN 1 AND 12` (23514) y UNIQUE
 *    (nino_id, anio, mes) (23505).
 *
 * NOTA DE SEMÁNTICA RLS (no es un bug): un INSERT que viola el WITH CHECK devuelve 42501,
 * pero un UPDATE/DELETE de un no-admin NO da error — la cláusula USING oculta la fila, así
 * que afecta 0 filas y devuelve `{ data: [], error: null }`. El invariante ("el no-admin no
 * puede modificar/borrar") se prueba comprobando, vía serviceClient, que la fila sobrevive
 * INTACTA tras el intento.
 *
 * Gateado: D6_BECA_COMEDOR_APPLIED=1 (requiere phase_d6_1 + d6_1b/1c aplicadas en la BD).
 */

const APPLIED = process.env.D6_BECA_COMEDOR_APPLIED === '1'

const ANIO = 2026

describe.skipIf(!APPLIED)('D-6 — beca_comedor_mes RLS + constraints', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let ninoA: Awaited<ReturnType<typeof createTestNino>>
  let ninoB: Awaited<ReturnType<typeof createTestNino>>
  let admin: TestUser
  let profe: TestUser
  let tutor: TestUser
  let outsider: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  let cProfe: Awaited<ReturnType<typeof clientFor>>
  let cTutor: Awaited<ReturnType<typeof clientFor>>
  let cOutsider: Awaited<ReturnType<typeof clientFor>>

  // Siembra una beca válida directamente (serviceClient bypassa RLS, no los CHECK).
  async function seedBeca(
    centroId: string,
    ninoId: string,
    mes: number,
    importe: number
  ): Promise<string> {
    const { data, error } = await serviceClient
      .from('beca_comedor_mes')
      .insert({ centro_id: centroId, nino_id: ninoId, anio: ANIO, mes, importe })
      .select('id')
      .single()
    if (error || !data) throw new Error(`seedBeca: ${error?.message}`)
    return data.id
  }

  async function importeDe(id: string): Promise<number | null> {
    const { data } = await serviceClient
      .from('beca_comedor_mes')
      .select('importe')
      .eq('id', id)
      .maybeSingle()
    return data ? Number(data.importe) : null
  }

  beforeAll(async () => {
    centroA = await createTestCentro('Centro D6 A')
    centroB = await createTestCentro('Centro D6 B')
    ninoA = await createTestNino(centroA.id, 'Nino D6 A')
    ninoB = await createTestNino(centroB.id, 'Nino D6 B')

    admin = await createTestUser({ nombre: 'Admin D6 A' })
    await asignarRol(admin.id, centroA.id, 'admin')
    cAdmin = await clientFor(admin)

    profe = await createTestUser({ nombre: 'Profe D6 A' })
    await asignarRol(profe.id, centroA.id, 'profe')
    cProfe = await clientFor(profe)

    // Tutor del centro A, ligado a la familia del niño A (y con rol de centro).
    tutor = await createTestUser({ nombre: 'Tutor D6 A' })
    await asignarRol(tutor.id, centroA.id, 'tutor_legal')
    await crearFamiliaTutor(ninoA.familia_id, tutor.id)
    cTutor = await clientFor(tutor)

    outsider = await createTestUser({ nombre: 'Outsider D6' })
    cOutsider = await clientFor(outsider)
  })

  afterAll(async () => {
    // Borra las becas ANTES de los centros: la FK beca_comedor_mes→ninos es RESTRICT y
    // deleteTestCentro borra los niños.
    await serviceClient.from('beca_comedor_mes').delete().eq('centro_id', centroA.id)
    await serviceClient.from('beca_comedor_mes').delete().eq('centro_id', centroB.id)
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(profe.id)
    await deleteTestUser(tutor.id)
    await deleteTestUser(outsider.id)
  })

  // ── RLS admin-only ─────────────────────────────────────────────────────────
  it('admin del centro: INSERT/SELECT/UPDATE/DELETE OK sobre su centro', async () => {
    const ins = await cAdmin
      .from('beca_comedor_mes')
      .insert({ centro_id: centroA.id, nino_id: ninoA.id, anio: ANIO, mes: 3, importe: 25.5 })
      .select('id')
      .single()
    expect(ins.error).toBeNull()
    const id = ins.data!.id

    const sel = await cAdmin.from('beca_comedor_mes').select('id, importe').eq('id', id)
    expect(sel.data ?? []).toHaveLength(1)
    expect(Number(sel.data![0]!.importe)).toBe(25.5)

    const upd = await cAdmin
      .from('beca_comedor_mes')
      .update({ importe: 30 })
      .eq('id', id)
      .select('id')
    expect(upd.error).toBeNull()
    expect(await importeDe(id)).toBe(30)

    const del = await cAdmin.from('beca_comedor_mes').delete().eq('id', id).select('id')
    expect(del.error).toBeNull()
    expect(await importeDe(id)).toBeNull()
  })

  it('outsider (sin membresía): SELECT vacío; INSERT 42501; UPDATE/DELETE no-op', async () => {
    const id = await seedBeca(centroA.id, ninoA.id, 4, 10)

    const sel = await cOutsider.from('beca_comedor_mes').select('id').eq('id', id)
    expect(sel.data ?? []).toHaveLength(0)

    const ins = await cOutsider
      .from('beca_comedor_mes')
      .insert({ centro_id: centroA.id, nino_id: ninoA.id, anio: ANIO, mes: 5, importe: 10 })
      .select('id')
    expect(ins.error?.code).toBe('42501')

    // UPDATE/DELETE: la RLS oculta la fila → 0 filas afectadas, sin error; la fila sobrevive.
    await cOutsider.from('beca_comedor_mes').update({ importe: 99 }).eq('id', id)
    expect(await importeDe(id)).toBe(10)
    await cOutsider.from('beca_comedor_mes').delete().eq('id', id)
    expect(await importeDe(id)).toBe(10)

    await serviceClient.from('beca_comedor_mes').delete().eq('id', id)
  })

  it('profe del centro: SELECT vacío; INSERT 42501; UPDATE/DELETE no-op', async () => {
    const id = await seedBeca(centroA.id, ninoA.id, 6, 12)

    const sel = await cProfe.from('beca_comedor_mes').select('id').eq('id', id)
    expect(sel.data ?? []).toHaveLength(0)

    const ins = await cProfe
      .from('beca_comedor_mes')
      .insert({ centro_id: centroA.id, nino_id: ninoA.id, anio: ANIO, mes: 7, importe: 12 })
      .select('id')
    expect(ins.error?.code).toBe('42501')

    await cProfe.from('beca_comedor_mes').update({ importe: 99 }).eq('id', id)
    expect(await importeDe(id)).toBe(12)
    await cProfe.from('beca_comedor_mes').delete().eq('id', id)
    expect(await importeDe(id)).toBe(12)

    await serviceClient.from('beca_comedor_mes').delete().eq('id', id)
  })

  it('tutor del centro: SELECT vacío; INSERT 42501', async () => {
    const id = await seedBeca(centroA.id, ninoA.id, 8, 15)

    const sel = await cTutor.from('beca_comedor_mes').select('id').eq('id', id)
    expect(sel.data ?? []).toHaveLength(0)

    const ins = await cTutor
      .from('beca_comedor_mes')
      .insert({ centro_id: centroA.id, nino_id: ninoA.id, anio: ANIO, mes: 9, importe: 15 })
      .select('id')
    expect(ins.error?.code).toBe('42501')

    await serviceClient.from('beca_comedor_mes').delete().eq('id', id)
  })

  // ── Coherencia centro↔niño (D-6-1c) ──────────────────────────────────────────
  it('coherencia: admin de A NO puede INSERTAR beca centro=A con niño de B (42501)', async () => {
    const ins = await cAdmin
      .from('beca_comedor_mes')
      .insert({ centro_id: centroA.id, nino_id: ninoB.id, anio: ANIO, mes: 10, importe: 20 })
      .select('id')
    expect(ins.error?.code).toBe('42501')
  })

  it('coherencia: admin de A NO puede MOVER (UPDATE) una beca a un niño de B (42501)', async () => {
    const ins = await cAdmin
      .from('beca_comedor_mes')
      .insert({ centro_id: centroA.id, nino_id: ninoA.id, anio: ANIO, mes: 11, importe: 20 })
      .select('id')
      .single()
    expect(ins.error).toBeNull()
    const id = ins.data!.id

    const upd = await cAdmin
      .from('beca_comedor_mes')
      .update({ nino_id: ninoB.id })
      .eq('id', id)
      .select('id')
    expect(upd.error?.code).toBe('42501')

    await serviceClient.from('beca_comedor_mes').delete().eq('id', id)
  })

  // ── CHECK / UNIQUE ───────────────────────────────────────────────────────────
  it('CHECK importe > 0: rechaza 0 y negativo (23514)', async () => {
    const cero = await cAdmin
      .from('beca_comedor_mes')
      .insert({ centro_id: centroA.id, nino_id: ninoA.id, anio: ANIO, mes: 1, importe: 0 })
      .select('id')
    expect(cero.error?.code).toBe('23514')

    const neg = await cAdmin
      .from('beca_comedor_mes')
      .insert({ centro_id: centroA.id, nino_id: ninoA.id, anio: ANIO, mes: 1, importe: -5 })
      .select('id')
    expect(neg.error?.code).toBe('23514')
  })

  it('CHECK mes BETWEEN 1 AND 12: rechaza 13 y 0 (23514)', async () => {
    const trece = await cAdmin
      .from('beca_comedor_mes')
      .insert({ centro_id: centroA.id, nino_id: ninoA.id, anio: ANIO, mes: 13, importe: 20 })
      .select('id')
    expect(trece.error?.code).toBe('23514')

    const cero = await cAdmin
      .from('beca_comedor_mes')
      .insert({ centro_id: centroA.id, nino_id: ninoA.id, anio: ANIO, mes: 0, importe: 20 })
      .select('id')
    expect(cero.error?.code).toBe('23514')
  })

  it('UNIQUE (nino, anio, mes): duplicado 23505; mismo niño otro mes OK', async () => {
    const a = await cAdmin
      .from('beca_comedor_mes')
      .insert({ centro_id: centroA.id, nino_id: ninoA.id, anio: ANIO, mes: 12, importe: 20 })
      .select('id')
      .single()
    expect(a.error).toBeNull()

    const dup = await cAdmin
      .from('beca_comedor_mes')
      .insert({ centro_id: centroA.id, nino_id: ninoA.id, anio: ANIO, mes: 12, importe: 30 })
      .select('id')
    expect(dup.error?.code).toBe('23505')

    // Mismo niño, otro mes → permitido (la beca no persiste entre meses).
    const otro = await cAdmin
      .from('beca_comedor_mes')
      .insert({ centro_id: centroA.id, nino_id: ninoA.id, anio: ANIO, mes: 2, importe: 30 })
      .select('id')
    expect(otro.error).toBeNull()

    await serviceClient.from('beca_comedor_mes').delete().eq('id', a.data!.id)
    if (otro.data) await serviceClient.from('beca_comedor_mes').delete().eq('id', otro.data[0]!.id)
  })
})
