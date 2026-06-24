import { randomUUID } from 'crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  type TestAula,
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
 * F11-C-4 — Cierre del onboarding de profesor: prueba el **flujo completo** a nivel
 * BD/RLS, no por piezas: invitación → accept (cuenta nueva y B8-profe) → vínculo
 * `profes_aulas` con el tipo correcto → aislamiento entre centros → conflicto de
 * coordinadora (23505) → aislamiento del bucket `usuarios-fotos`.
 *
 * El flujo de la acción real (`acceptInvitation`/`acceptPendingInvitation`) usa
 * `next/headers` (getRequestContext) + `auth.admin.createUser` → no es invocable en
 * vitest (igual que `alta-p1-fundacion.rls`); aquí se REPLICAN sus efectos de BD por
 * service-role (crear cuenta + `roles_usuario` + `profes_aulas` + `accepted_at`) y se
 * asserta el resultado RLS. El camino de la acción se verifica en preview.
 *
 * **Gated** por `F11C0_MIGRATION_APPLIED=1` (columnas de F11-C-0 + bucket/políticas de
 * `usuarios-fotos`, aplicadas a mano por SQL Editor — CLI SIGILL). Comando:
 *   F11C0_MIGRATION_APPLIED=1 npm run test:rls -- onboarding-profe.rls
 */
const APPLIED = process.env.F11C0_MIGRATION_APPLIED === '1'

const BUCKET = 'usuarios-fotos'
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const enUnDia = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

type Tipo = 'coordinadora' | 'profesora' | 'tecnico' | 'apoyo'

describe.skipIf(!APPLIED)('Onboarding de profe — flujo completo (DB/RLS)', () => {
  let centroA: { id: string }
  let cursoA: { id: string }
  let aulaA1: { id: string }
  let aulaA2: TestAula
  let centroB: { id: string }
  let cursoB: { id: string }
  let aulaB1: { id: string }
  let ninoA1: { id: string }
  let ninoB1: { id: string }

  const usuarios: string[] = []
  const invitaciones: string[] = []
  const objetos: string[] = []

  // Profe dado de alta en el primer test; reutilizado para el aislamiento.
  let profeA: TestUser

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Onboarding A')
    cursoA = await createTestCurso(centroA.id)
    aulaA1 = await createTestAula(centroA.id, cursoA.id, 'Aula A1')
    aulaA2 = await createTestAula(centroA.id, cursoA.id, 'Aula A2')
    ninoA1 = await createTestNino(centroA.id)
    await matricular(ninoA1.id, aulaA1.id, cursoA.id)

    centroB = await createTestCentro('Centro Onboarding B')
    cursoB = await createTestCurso(centroB.id)
    aulaB1 = await createTestAula(centroB.id, cursoB.id, 'Aula B1')
    ninoB1 = await createTestNino(centroB.id)
    await matricular(ninoB1.id, aulaB1.id, cursoB.id)
  })

  afterAll(async () => {
    for (const p of objetos) await serviceClient.storage.from(BUCKET).remove([p])
    if (invitaciones.length)
      await serviceClient.from('invitaciones').delete().in('id', invitaciones)
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
    for (const id of usuarios) await deleteTestUser(id)
  })

  /** Inserta la invitación de profe que crearía la directora (F11-C-1). */
  async function invitarProfe(aulaId: string, tipo: Tipo) {
    const { data, error } = await serviceClient
      .from('invitaciones')
      .insert({
        email: `f11c4-${randomUUID()}@nido.test`,
        rol_objetivo: 'profe',
        centro_id: centroA.id,
        aula_id: aulaId,
        nombre_completo: 'Profe Pruebas',
        tipo_personal_aula: tipo,
        expires_at: enUnDia(),
      })
      .select('id, centro_id, aula_id, tipo_personal_aula')
      .single()
    if (error || !data) throw new Error(`invitarProfe: ${error?.message}`)
    invitaciones.push(data.id)
    return data
  }

  /** Replica el accept (cuenta NUEVA): crea la cuenta + rol profe + profes_aulas. */
  async function aceptarCuentaNueva(inv: {
    id: string
    aula_id: string | null
    tipo_personal_aula: Tipo | null
  }) {
    const user = await createTestUser({ nombre: 'Profe Nuevo' })
    usuarios.push(user.id)
    await asignarRol(user.id, centroA.id, 'profe')
    const { data: ac } = await serviceClient
      .from('aulas_curso')
      .select('curso_academico_id')
      .eq('aula_id', inv.aula_id!)
      .limit(1)
      .maybeSingle()
    const { error } = await serviceClient.from('profes_aulas').insert({
      profe_id: user.id,
      aula_id: inv.aula_id!,
      curso_academico_id: ac!.curso_academico_id,
      tipo_personal_aula: inv.tipo_personal_aula!,
    })
    if (error) throw new Error(`aceptarCuentaNueva (profes_aulas): ${error.message}`)
    await serviceClient
      .from('invitaciones')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', inv.id)
    return user
  }

  it('cuenta nueva: invitación → accept enlaza profes_aulas con el tipo correcto', async () => {
    const inv = await invitarProfe(aulaA1.id, 'profesora')
    profeA = await aceptarCuentaNueva(inv)

    const { data: rol } = await serviceClient
      .from('roles_usuario')
      .select('rol')
      .eq('usuario_id', profeA.id)
      .eq('centro_id', centroA.id)
      .eq('rol', 'profe')
      .maybeSingle()
    expect(rol?.rol).toBe('profe')

    const { data: link } = await serviceClient
      .from('profes_aulas')
      .select('aula_id, tipo_personal_aula, fecha_fin')
      .eq('profe_id', profeA.id)
      .maybeSingle()
    expect(link?.aula_id).toBe(aulaA1.id)
    expect(link?.tipo_personal_aula).toBe('profesora')
    expect(link?.fecha_fin).toBeNull()

    const { data: inv2 } = await serviceClient
      .from('invitaciones')
      .select('accepted_at')
      .eq('id', inv.id)
      .single()
    expect(inv2?.accepted_at).not.toBeNull()
  })

  it('aislamiento entre centros: el profe ve a su niño, NO al de otro centro', async () => {
    const client = await clientFor(profeA)

    const propio = await client.from('ninos').select('id').eq('id', ninoA1.id).maybeSingle()
    expect(propio.data?.id).toBe(ninoA1.id)

    const ajeno = await client.from('ninos').select('id').eq('id', ninoB1.id).maybeSingle()
    expect(ajeno.data).toBeNull()
  })

  it('B8-profe: un tutor existente acepta como profe → rol profe + profes_aulas', async () => {
    // Cuenta ya existente: tutor de un niño del centro.
    const tutor = await createTestUser({ nombre: 'Tutor que es Profe' })
    usuarios.push(tutor.id)
    await asignarRol(tutor.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA1.id, tutor.id, 'tutor_legal_principal')

    const inv = await invitarProfe(aulaA2.id, 'profesora')
    // Replica B8: inserta rol profe (idempotente) + profes_aulas, sin crear otra cuenta.
    await asignarRol(tutor.id, centroA.id, 'profe')
    const { error } = await serviceClient.from('profes_aulas').insert({
      profe_id: tutor.id,
      aula_id: inv.aula_id!,
      curso_academico_id: aulaA2.curso_academico_id,
      tipo_personal_aula: inv.tipo_personal_aula!,
    })
    expect(error).toBeNull()

    const { data: roles } = await serviceClient
      .from('roles_usuario')
      .select('rol')
      .eq('usuario_id', tutor.id)
      .is('deleted_at', null)
    const setRoles = new Set((roles ?? []).map((r) => r.rol))
    expect(setRoles.has('tutor_legal')).toBe(true)
    expect(setRoles.has('profe')).toBe(true)

    const { data: link } = await serviceClient
      .from('profes_aulas')
      .select('tipo_personal_aula')
      .eq('profe_id', tutor.id)
      .eq('aula_id', aulaA2.id)
      .maybeSingle()
    expect(link?.tipo_personal_aula).toBe('profesora')
  })

  it('conflicto coordinadora (23505): una segunda coordinadora activa en el aula falla', async () => {
    const aula = await createTestAula(centroA.id, cursoA.id, 'Aula Coord')

    const coord1 = await createTestUser({ nombre: 'Coordinadora 1' })
    const coord2 = await createTestUser({ nombre: 'Coordinadora 2' })
    usuarios.push(coord1.id, coord2.id)
    await asignarRol(coord1.id, centroA.id, 'profe')
    await asignarRol(coord2.id, centroA.id, 'profe')

    const primera = await serviceClient.from('profes_aulas').insert({
      profe_id: coord1.id,
      aula_id: aula.id,
      curso_academico_id: aula.curso_academico_id,
      tipo_personal_aula: 'coordinadora',
    })
    expect(primera.error).toBeNull()

    const segunda = await serviceClient.from('profes_aulas').insert({
      profe_id: coord2.id,
      aula_id: aula.id,
      curso_academico_id: aula.curso_academico_id,
      tipo_personal_aula: 'coordinadora',
    })
    expect(segunda.error?.code).toBe('23505')
  })

  it('bucket usuarios-fotos: el profe sube SU avatar, no el de otro', async () => {
    const client = await clientFor(profeA)

    const propio = `${centroA.id}/${profeA.id}/${randomUUID()}.jpg`
    const ok = await client.storage
      .from(BUCKET)
      .upload(propio, JPG, { contentType: 'image/jpeg', upsert: true })
    if (!ok.error) objetos.push(propio)
    expect(ok.error).toBeNull()

    const otro = await createTestUser({ nombre: 'Otro Profe' })
    usuarios.push(otro.id)
    const ajeno = `${centroA.id}/${otro.id}/${randomUUID()}.jpg`
    const denied = await client.storage
      .from(BUCKET)
      .upload(ajeno, JPG, { contentType: 'image/jpeg', upsert: true })
    if (!denied.error) objetos.push(ajeno)
    expect(denied.error).not.toBeNull()
  })
})
