import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * RLS de `acuses_alta` INSERT — Alta unificada U-0.
 *
 * La migración `20260823120000_phase_alta_u0_acuses_admin` añade la rama admin a
 * `acuses_alta_insert`: la Dirección (admin del centro, SIN vínculo) puede
 * registrar el acuse de normas por checkbox en modo Dirección. Verifica:
 *  - admin del centro del niño puede INSERT (rama nueva),
 *  - tutor del niño sigue pudiendo INSERT (camino intacto, se añadió con OR),
 *  - admin de OTRO centro NO puede INSERT (nunca cross-centro),
 *  - `firmante_id = auth.uid()` se mantiene (anti-suplantación).
 */
describe('RLS acuses_alta INSERT — admin del centro + tutor (U-0)', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let aulaA: { id: string }
  let ninoAdmin: { id: string; centro_id: string; familia_id: string }
  let ninoTutor: { id: string; centro_id: string; familia_id: string }
  let adminA: TestUser
  let adminB: TestUser
  let tutor: TestUser

  beforeAll(async () => {
    centroA = await createTestCentro('Centro AcusesU0 A')
    centroB = await createTestCentro('Centro AcusesU0 B')
    cursoA = await createTestCurso(centroA.id)
    aulaA = await createTestAula(centroA.id, cursoA.id)

    ninoAdmin = await createTestNino(centroA.id, 'Nino AcuseAdmin')
    ninoTutor = await createTestNino(centroA.id, 'Nino AcuseTutor')
    await matricular(ninoAdmin.id, aulaA.id, cursoA.id)
    await matricular(ninoTutor.id, aulaA.id, cursoA.id)

    adminA = await createTestUser({ nombre: 'Directora A' })
    adminB = await createTestUser({ nombre: 'Directora B' })
    tutor = await createTestUser({ nombre: 'Tutor Legal' })

    await asignarRol(adminA.id, centroA.id, 'admin')
    await asignarRol(adminB.id, centroB.id, 'admin')
    await asignarRol(tutor.id, centroA.id, 'tutor_legal')
    // El tutor lo es de `ninoTutor` (es_tutor_de mira vinculos_familiares).
    await crearVinculo(ninoTutor.id, tutor.id, 'tutor_legal_principal')
  })

  afterAll(async () => {
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
    await deleteTestUser(adminA.id)
    await deleteTestUser(adminB.id)
    await deleteTestUser(tutor.id)
  })

  it('admin del centro del niño registra el acuse de normas (rama nueva)', async () => {
    const db = await clientFor(adminA)
    const { data, error } = await db
      .from('acuses_alta')
      .insert({
        nino_id: ninoAdmin.id,
        centro_id: centroA.id,
        tipo: 'normas',
        firmante_id: adminA.id,
      })
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
  })

  it('tutor del niño sigue pudiendo registrar su acuse (camino intacto)', async () => {
    const db = await clientFor(tutor)
    const { data, error } = await db
      .from('acuses_alta')
      .insert({
        nino_id: ninoTutor.id,
        centro_id: centroA.id,
        tipo: 'normas',
        firmante_id: tutor.id,
      })
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
  })

  it('admin de OTRO centro NO puede registrar el acuse (nunca cross-centro)', async () => {
    const db = await clientFor(adminB)
    const { data, error } = await db
      .from('acuses_alta')
      .insert({
        nino_id: ninoAdmin.id,
        centro_id: centroA.id,
        tipo: 'imagen',
        firmante_id: adminB.id,
      })
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(data).toBeNull()
    // Nada se insertó (RLS rechazó, no fue un no-op silencioso).
    const { count } = await serviceClient
      .from('acuses_alta')
      .select('id', { count: 'exact', head: true })
      .eq('nino_id', ninoAdmin.id)
      .eq('tipo', 'imagen')
    expect(count ?? 0).toBe(0)
  })

  it('admin no puede suplantar el firmante (firmante_id = auth.uid())', async () => {
    const db = await clientFor(adminA)
    const { data, error } = await db
      .from('acuses_alta')
      .insert({
        nino_id: ninoAdmin.id,
        centro_id: centroA.id,
        tipo: 'imagen',
        firmante_id: tutor.id, // distinto de auth.uid() (adminA) → WITH CHECK falla
      })
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })
})
