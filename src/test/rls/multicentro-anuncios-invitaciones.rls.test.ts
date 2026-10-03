import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { destinatariosPushDeAnuncio } from '@/features/push/lib/audiencia'

import {
  asignarProfeAula,
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

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Seguridad multi-centro — R3 (anuncios) y R2 (invitaciones).
 *
 * Migración: 20261004120000_fix_multicentro_anuncios_invitaciones
 *   R3: rama admin de `anuncios_insert` endurecida, comprobación de centro en la rama 'aula' de
 *       los helpers de audiencia, trigger `anuncios_validar_aula_centro_trg` (aula ∈ centro).
 *   R2: trigger `invitaciones_validar_centro_trg` (niño ∈ centro, aula ∈ centro).
 *
 * Dos centros (A y B). Se comprueba que nada cruza de A a B por ninguna de las vías (insert,
 * lectura, push, service role) y que el caso normal de UN centro sigue igual.
 *
 * Gateado (la migración la aplica Jose a mano): MULTICENTRO_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.MULTICENTRO_APPLIED === '1'

type Client = SupabaseClient<Database>

describe.skipIf(!MIGRATION_APPLIED)('multi-centro — anuncios (R3) e invitaciones (R2)', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let aulaA1: { id: string }
  let aulaA2: { id: string }
  let aulaB1: { id: string }
  let ninoA1: { id: string }
  let ninoB: { id: string }
  let adminA: TestUser
  let profeA1: TestUser
  let profeB: TestUser
  let tutorA: TestUser
  let tutorB: TestUser
  let cAdminA: Client
  let cProfeA1: Client
  let cProfeB: Client
  let cTutorA: Client
  let cTutorB: Client

  beforeAll(async () => {
    centroA = await createTestCentro('Centro MC A')
    centroB = await createTestCentro('Centro MC B')
    const cursoA = await createTestCurso(centroA.id)
    const cursoB = await createTestCurso(centroB.id)
    aulaA1 = await createTestAula(centroA.id, cursoA.id, 'Aula MC A1')
    aulaA2 = await createTestAula(centroA.id, cursoA.id, 'Aula MC A2')
    aulaB1 = await createTestAula(centroB.id, cursoB.id, 'Aula MC B1')
    ninoA1 = await createTestNino(centroA.id, 'Niño MC A1')
    ninoB = await createTestNino(centroB.id, 'Niño MC B')
    await matricular(ninoA1.id, aulaA1.id, cursoA.id)
    await matricular(ninoB.id, aulaB1.id, cursoB.id)

    adminA = await createTestUser({ nombre: 'Admin MC A' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    profeA1 = await createTestUser({ nombre: 'Profe MC A1' })
    await asignarRol(profeA1.id, centroA.id, 'profe')
    await asignarProfeAula(profeA1.id, aulaA1.id)
    profeB = await createTestUser({ nombre: 'Profe MC B' })
    await asignarRol(profeB.id, centroB.id, 'profe')
    await asignarProfeAula(profeB.id, aulaB1.id)
    tutorA = await createTestUser({ nombre: 'Tutor MC A' })
    await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA1.id, tutorA.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })
    tutorB = await createTestUser({ nombre: 'Tutor MC B' })
    await asignarRol(tutorB.id, centroB.id, 'tutor_legal')
    await crearVinculo(ninoB.id, tutorB.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })

    cAdminA = await clientFor(adminA)
    cProfeA1 = await clientFor(profeA1)
    cProfeB = await clientFor(profeB)
    cTutorA = await clientFor(tutorA)
    cTutorB = await clientFor(tutorB)
  }, 120_000)

  afterAll(async () => {
    for (const c of [centroA, centroB]) {
      await serviceClient.from('anuncios').delete().eq('centro_id', c.id)
      await serviceClient.from('invitaciones').delete().eq('centro_id', c.id)
    }
    for (const u of [adminA, profeA1, profeB, tutorA, tutorB]) await deleteTestUser(u.id)
    for (const c of [centroA, centroB]) await deleteTestCentro(c.id)
  }, 120_000)

  const anuncio = (autor: string, aula_id: string | null, centro_id = centroA.id) => ({
    autor_id: autor,
    centro_id,
    ambito: (aula_id ? 'aula' : 'centro') as 'aula' | 'centro',
    aula_id,
    titulo: 'MC',
    contenido: 'Anuncio multi-centro',
  })
  const insertar = (c: Client, row: ReturnType<typeof anuncio>) =>
    c.from('anuncios').insert(row).select('id').maybeSingle()

  // ---------------------------------------------------------------- R3: INSERT
  it('R3 insert: admin de A NO publica en un aula de B', async () => {
    const r = await insertar(cAdminA, anuncio(adminA.id, aulaB1.id))
    expect(r.error).not.toBeNull()
    expect(r.data).toBeNull()
  })

  it('R3 insert (caso normal): admin de A publica en su aula y a todo el centro', async () => {
    const aula = await insertar(cAdminA, anuncio(adminA.id, aulaA1.id))
    expect(aula.error).toBeNull()
    const centro = await insertar(cAdminA, anuncio(adminA.id, null))
    expect(centro.error).toBeNull()
  })

  it('R3 insert (rama profe intacta): la profe publica en su aula, no en otra', async () => {
    const suya = await insertar(cProfeA1, anuncio(profeA1.id, aulaA1.id))
    expect(suya.error).toBeNull()
    const otra = await insertar(cProfeA1, anuncio(profeA1.id, aulaA2.id))
    expect(otra.error).not.toBeNull()
  })

  it('R3 trigger: tampoco service role cuela un aula de otro centro (23514)', async () => {
    const r = await insertar(serviceClient, anuncio(adminA.id, aulaB1.id))
    expect(r.error?.code).toBe('23514')
  })

  // ---------------------------------------------------------------- R3: LECTURA
  const ve = (c: Client, centro: string, aula: string) =>
    c.rpc('usuario_es_audiencia_anuncio_row', {
      p_centro_id: centro,
      p_autor_id: adminA.id,
      p_ambito: 'aula',
      p_aula_id: aula,
    })

  it('R3 lectura: familia y profe de B NO ven un anuncio de A con aula de B', async () => {
    expect((await ve(cTutorB, centroA.id, aulaB1.id)).data).toBe(false)
    expect((await ve(cProfeB, centroA.id, aulaB1.id)).data).toBe(false)
  })

  it('R3 lectura (caso normal): cada uno ve el de su propio centro', async () => {
    expect((await ve(cTutorA, centroA.id, aulaA1.id)).data).toBe(true)
    expect((await ve(cProfeA1, centroA.id, aulaA1.id)).data).toBe(true)
    expect((await ve(cTutorB, centroB.id, aulaB1.id)).data).toBe(true)
  })

  // ---------------------------------------------------------------- R3: PUSH
  it('R3 push: la audiencia de un anuncio de A nunca incluye tutores de B', async () => {
    const cruzado = await destinatariosPushDeAnuncio(
      { centro_id: centroA.id, ambito: 'aula', aula_id: aulaB1.id },
      adminA.id
    )
    expect(cruzado).not.toContain(tutorB.id)
    expect(cruzado).toEqual([])

    const propio = await destinatariosPushDeAnuncio(
      { centro_id: centroA.id, ambito: 'aula', aula_id: aulaA1.id },
      adminA.id
    )
    expect(propio).toContain(tutorA.id)
    expect(propio).not.toContain(tutorB.id)
  })

  // ---------------------------------------------------------------- R2
  const invitacion = (extra: Record<string, unknown>) => ({
    email: `mc-${Math.random().toString(36).slice(2, 10)}@nido.test`,
    centro_id: centroA.id,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    ...extra,
  })

  it('R2: admin de A NO invita con un niño de B ni con un aula de B (23514)', async () => {
    const nino = await cAdminA
      .from('invitaciones')
      .insert(
        invitacion({
          rol_objetivo: 'tutor_legal',
          nino_id: ninoB.id,
          tipo_vinculo: 'tutor_legal_principal',
        }) as never
      )
      .select('id')
      .maybeSingle()
    expect(nino.error?.code).toBe('23514')

    const aula = await cAdminA
      .from('invitaciones')
      .insert(invitacion({ rol_objetivo: 'profe', aula_id: aulaB1.id }) as never)
      .select('id')
      .maybeSingle()
    expect(aula.error?.code).toBe('23514')
  })

  it('R2 (caso normal): admin de A invita con niño y aula de A', async () => {
    const nino = await cAdminA
      .from('invitaciones')
      .insert(
        invitacion({
          rol_objetivo: 'tutor_legal',
          nino_id: ninoA1.id,
          tipo_vinculo: 'tutor_legal_principal',
        }) as never
      )
      .select('id')
      .maybeSingle()
    expect(nino.error).toBeNull()

    const aula = await cAdminA
      .from('invitaciones')
      .insert(invitacion({ rol_objetivo: 'profe', aula_id: aulaA1.id }) as never)
      .select('id')
      .maybeSingle()
    expect(aula.error).toBeNull()
  })

  it('R2 trigger: tampoco service role ata una invitación a un niño de otro centro (23514)', async () => {
    const r = await serviceClient
      .from('invitaciones')
      .insert(
        invitacion({
          rol_objetivo: 'tutor_legal',
          nino_id: ninoB.id,
          tipo_vinculo: 'tutor_legal_principal',
        }) as never
      )
      .select('id')
      .maybeSingle()
    expect(r.error?.code).toBe('23514')
  })
})
