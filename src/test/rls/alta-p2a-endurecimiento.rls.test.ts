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
 * F11 · Alta tutor-driven · Pieza 2a — ENDURECIMIENTO de "matrícula activa".
 *
 * Migración 20260616120000_phase11_alta_p2a_endurecimiento: los 9 helpers RLS que
 * definían matrícula activa como `fecha_baja IS NULL AND deleted_at IS NULL` ahora
 * exigen además `estado = 'activa'`. Una matrícula `'pendiente'` (esqueleto de niño,
 * Pieza 2b) tiene `fecha_baja IS NULL` → sin el cambio colaría como activa.
 *
 * Se verifica end-to-end vía la policy SELECT de `anuncios` (que usa el helper
 * row-aware `usuario_es_audiencia_anuncio_row`, el más delicado por el gotcha MVCC):
 * un tutor con `puede_recibir_mensajes` ve los anuncios de su aula/centro SOLO si la
 * matrícula del niño está 'activa'; con 'pendiente' deja de verlos. Con 'activa'
 * vuelve a verlos (no-op para matrículas reales = regresión-cero).
 *
 * Gateado por flag (migración a mano vía Management API — CLI SIGILL):
 *   F11_ALTA_P2A_MIGRATION_APPLIED=1
 */

const APPLIED = process.env.F11_ALTA_P2A_MIGRATION_APPLIED === '1'

describe.skipIf(!APPLIED)('Alta P2a — endurecimiento matrícula activa (RLS)', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string; curso_academico_id: string }
  let admin: TestUser
  let tutor: TestUser
  let nino: { id: string }
  let matriculaId: string
  let anuncioAulaId: string
  let anuncioCentroId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro Alta P2a')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)

    admin = await createTestUser({ nombre: 'Admin P2a' })
    await asignarRol(admin.id, centro.id, 'admin')

    tutor = await createTestUser({ nombre: 'Tutor P2a' })
    await asignarRol(tutor.id, centro.id, 'tutor_legal')

    nino = await createTestNino(centro.id)
    matriculaId = await matricular(nino.id, aula.id, aula.curso_academico_id)
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })

    // Anuncios (autor = admin) de ámbito aula y centro.
    const { data: aAula, error: eAula } = await serviceClient
      .from('anuncios')
      .insert({
        autor_id: admin.id,
        centro_id: centro.id,
        ambito: 'aula',
        aula_id: aula.id,
        titulo: 'Anuncio aula P2a',
        contenido: 'cuerpo',
      })
      .select('id')
      .single()
    if (eAula || !aAula) throw new Error(`insert anuncio aula: ${eAula?.message}`)
    anuncioAulaId = aAula.id

    const { data: aCentro, error: eCentro } = await serviceClient
      .from('anuncios')
      .insert({
        autor_id: admin.id,
        centro_id: centro.id,
        ambito: 'centro',
        aula_id: null,
        titulo: 'Anuncio centro P2a',
        contenido: 'cuerpo',
      })
      .select('id')
      .single()
    if (eCentro || !aCentro) throw new Error(`insert anuncio centro: ${eCentro?.message}`)
    anuncioCentroId = aCentro.id
  })

  afterAll(async () => {
    await serviceClient.from('anuncios').delete().in('id', [anuncioAulaId, anuncioCentroId])
    await serviceClient.from('vinculos_familiares').delete().eq('nino_id', nino.id)
    await serviceClient.from('matriculas').delete().eq('id', matriculaId)
    await serviceClient.from('ninos').delete().eq('id', nino.id)
    await serviceClient.from('roles_usuario').delete().eq('usuario_id', admin.id)
    await serviceClient.from('roles_usuario').delete().eq('usuario_id', tutor.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(tutor.id)
    await deleteTestCentro(centro.id)
  })

  async function setEstado(estado: 'activa' | 'pendiente' | 'baja') {
    const { error } = await serviceClient
      .from('matriculas')
      .update({ estado })
      .eq('id', matriculaId)
    if (error) throw new Error(`setEstado(${estado}): ${error.message}`)
  }

  async function tutorVeAnuncio(id: string): Promise<boolean> {
    const tc = await clientFor(tutor)
    const { data } = await tc.from('anuncios').select('id').eq('id', id).maybeSingle()
    return data?.id === id
  }

  it("matrícula 'pendiente' tiene fecha_baja NULL (sin el endurecimiento colaría como activa)", async () => {
    await setEstado('pendiente')
    const { data } = await serviceClient
      .from('matriculas')
      .select('estado, fecha_baja')
      .eq('id', matriculaId)
      .single()
    expect(data?.estado).toBe('pendiente')
    expect(data?.fecha_baja).toBeNull()
    await setEstado('activa')
  })

  it("con matrícula 'activa' el tutor VE el anuncio de aula y de centro (regresión-cero)", async () => {
    await setEstado('activa')
    expect(await tutorVeAnuncio(anuncioAulaId)).toBe(true)
    expect(await tutorVeAnuncio(anuncioCentroId)).toBe(true)
  })

  it("con matrícula 'pendiente' el tutor NO ve el anuncio de aula ni de centro", async () => {
    await setEstado('pendiente')
    expect(await tutorVeAnuncio(anuncioAulaId)).toBe(false)
    expect(await tutorVeAnuncio(anuncioCentroId)).toBe(false)
    await setEstado('activa')
  })

  it("reactivar la matrícula ('activa') restaura la visibilidad", async () => {
    await setEstado('activa')
    expect(await tutorVeAnuncio(anuncioAulaId)).toBe(true)
  })
})
