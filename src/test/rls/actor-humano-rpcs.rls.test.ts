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
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * PR-D (auditoría F11-D, D2) — el actor humano queda en `audit_log`.
 *
 * Migración: 20261005120000_fix_actor_humano_rpcs_ninos
 *   Tres RPC SECURITY DEFINER que la app llama con el cliente de SESIÓN, en vez de escribir
 *   `ninos` con service role (que dejaba `usuario_id` NULL en el audit):
 *     - actualizar_familia_nino(nino, patch)   dirección + estado civil (5 columnas);
 *     - fijar_libro_familia_nino(nino, path)   con backstop de ruta {centro}/{niño}/x.pdf;
 *     - quitar_foto_perfil_nino(nino)          foto_url → NULL.
 *   Autorizan admin del centro del niño o tutor legal; con el alta validada el tutor no
 *   escribe directo (cola de validación). EXECUTE solo para authenticated.
 *
 * También cubre los dos flujos que pasan a sesión sin migración: aplicar un cambio pendiente
 * (la directora escribe `ninos` y `familia_tutores` por su RLS de admin).
 *
 * Gateado (la migración la aplica Jose a mano): ACTOR_HUMANO_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.ACTOR_HUMANO_APPLIED === '1'

type Client = SupabaseClient<Database>

describe.skipIf(!MIGRATION_APPLIED)('D2 — el actor humano queda en audit_log', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let ninoA: { id: string; familia_id: string }
  let ninoValidado: { id: string }
  let ninoB: { id: string }
  let adminA: TestUser
  let adminB: TestUser
  let tutorA: TestUser
  let autorizadoA: TestUser
  let tutorB: TestUser
  let cAdminA: Client
  let cAdminB: Client
  let cTutorA: Client
  let cAutorizadoA: Client
  let cTutorB: Client

  beforeAll(async () => {
    centroA = await createTestCentro('Centro D2 A')
    centroB = await createTestCentro('Centro D2 B')
    const cursoA = await createTestCurso(centroA.id)
    const aulaA = await createTestAula(centroA.id, cursoA.id, 'Aula D2 A')
    // ninoA SIN matrícula → alta sin validar (el tutor escribe directo).
    ninoA = await createTestNino(centroA.id, 'Niño D2 A')
    // ninoValidado con matrícula `activa` → alta validada (el tutor va a la cola).
    ninoValidado = await createTestNino(centroA.id, 'Niño D2 validado')
    await matricular(ninoValidado.id, aulaA.id, cursoA.id)
    ninoB = await createTestNino(centroB.id, 'Niño D2 B')

    adminA = await createTestUser({ nombre: 'Directora D2 A' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    adminB = await createTestUser({ nombre: 'Directora D2 B' })
    await asignarRol(adminB.id, centroB.id, 'admin')
    tutorA = await createTestUser({ nombre: 'Tutor D2 A' })
    await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA.id, tutorA.id, 'tutor_legal_principal')
    await crearVinculo(ninoValidado.id, tutorA.id, 'tutor_legal_principal')
    autorizadoA = await createTestUser({ nombre: 'Autorizado D2 A' })
    await asignarRol(autorizadoA.id, centroA.id, 'autorizado')
    await crearVinculo(ninoA.id, autorizadoA.id, 'autorizado')
    tutorB = await createTestUser({ nombre: 'Tutor D2 B' })
    await asignarRol(tutorB.id, centroB.id, 'tutor_legal')
    await crearVinculo(ninoB.id, tutorB.id, 'tutor_legal_principal')

    cAdminA = await clientFor(adminA)
    cAdminB = await clientFor(adminB)
    cTutorA = await clientFor(tutorA)
    cAutorizadoA = await clientFor(autorizadoA)
    cTutorB = await clientFor(tutorB)
  }, 120_000)

  afterAll(async () => {
    for (const u of [adminA, adminB, tutorA, autorizadoA, tutorB]) await deleteTestUser(u.id)
    for (const c of [centroA, centroB]) await deleteTestCentro(c.id)
  }, 120_000)

  /** Actor de la última fila de audit de `tabla` para `registroId`. */
  async function ultimoActor(tabla: string, registroId: string): Promise<string | null> {
    const { data, error } = await serviceClient
      .from('audit_log')
      .select('usuario_id')
      .eq('tabla', tabla)
      .eq('registro_id', registroId)
      .order('ts', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data?.usuario_id ?? null
  }

  async function fila(ninoId: string) {
    const { data } = await serviceClient
      .from('ninos')
      .select('direccion_calle, libro_familia_path, foto_url')
      .eq('id', ninoId)
      .single()
    return data!
  }

  const libro = (centro: string, nino: string, nombre = 'libro') =>
    `${centro}/${nino}/${nombre}.pdf`

  // ------------------------------------------------- el actor humano queda registrado
  it('directora cambia la dirección → audit con SU uid', async () => {
    const r = await cAdminA.rpc('actualizar_familia_nino', {
      p_nino_id: ninoA.id,
      p_patch: { direccion_calle: 'Calle Directora 1' },
    })
    expect(r.error).toBeNull()
    expect((await fila(ninoA.id)).direccion_calle).toBe('Calle Directora 1')
    expect(await ultimoActor('ninos', ninoA.id)).toBe(adminA.id)
  })

  it('tutor legal cambia la dirección y el estado civil → audit con SU uid', async () => {
    const r = await cTutorA.rpc('actualizar_familia_nino', {
      p_nino_id: ninoA.id,
      p_patch: { direccion_calle: 'Calle Tutor 2', estado_civil_familia: 'casados' },
    })
    expect(r.error).toBeNull()
    expect(await ultimoActor('ninos', ninoA.id)).toBe(tutorA.id)
  })

  it('un null explícito limpia; una clave ausente no se toca', async () => {
    const r = await cTutorA.rpc('actualizar_familia_nino', {
      p_nino_id: ninoA.id,
      p_patch: { direccion_cp: null },
    })
    expect(r.error).toBeNull()
    expect((await fila(ninoA.id)).direccion_calle).toBe('Calle Tutor 2')
  })

  it('tutor sube el libro de familia → audit con SU uid y devuelve el anterior', async () => {
    const primero = await cTutorA.rpc('fijar_libro_familia_nino', {
      p_nino_id: ninoA.id,
      p_path: libro(centroA.id, ninoA.id, 'uno'),
    })
    expect(primero.error).toBeNull()
    const segundo = await cTutorA.rpc('fijar_libro_familia_nino', {
      p_nino_id: ninoA.id,
      p_path: libro(centroA.id, ninoA.id, 'dos'),
    })
    expect(segundo.error).toBeNull()
    expect(segundo.data).toBe(libro(centroA.id, ninoA.id, 'uno'))
    expect(await ultimoActor('ninos', ninoA.id)).toBe(tutorA.id)
  })

  it('tutor quita la foto de perfil de SU hijo → audit con SU uid', async () => {
    const foto = `${centroA.id}/${ninoA.id}/perfil.jpg`
    await serviceClient.from('ninos').update({ foto_url: foto }).eq('id', ninoA.id)
    const r = await cTutorA.rpc('quitar_foto_perfil_nino', { p_nino_id: ninoA.id })
    expect(r.error).toBeNull()
    expect(r.data).toBe(foto)
    expect((await fila(ninoA.id)).foto_url).toBeNull()
    expect(await ultimoActor('ninos', ninoA.id)).toBe(tutorA.id)
  })

  // ------------------------------------------------- no autorizados
  it.each([
    ['tutor de OTRO niño (centro B)', () => cTutorB],
    ['vínculo autorizado (no legal)', () => cAutorizadoA],
    ['directora de OTRO centro', () => cAdminB],
  ])('%s → 42501 en las tres RPC y nada cambia', async (_n, cliente) => {
    const antes = await fila(ninoA.id)
    const c = cliente()
    const r1 = await c.rpc('actualizar_familia_nino', {
      p_nino_id: ninoA.id,
      p_patch: { direccion_calle: 'Intruso' },
    })
    const r2 = await c.rpc('fijar_libro_familia_nino', {
      p_nino_id: ninoA.id,
      p_path: libro(centroA.id, ninoA.id, 'intruso'),
    })
    const r3 = await c.rpc('quitar_foto_perfil_nino', { p_nino_id: ninoA.id })
    for (const r of [r1, r2, r3]) expect(r.error?.code).toBe('42501')
    expect(await fila(ninoA.id)).toEqual(antes)
  })

  it('anon no puede ejecutar ninguna de las tres', async () => {
    const anon = anonClient()
    const r1 = await anon.rpc('actualizar_familia_nino', { p_nino_id: ninoA.id, p_patch: {} })
    const r2 = await anon.rpc('fijar_libro_familia_nino', {
      p_nino_id: ninoA.id,
      p_path: libro(centroA.id, ninoA.id),
    })
    const r3 = await anon.rpc('quitar_foto_perfil_nino', { p_nino_id: ninoA.id })
    for (const r of [r1, r2, r3]) expect(r.error).not.toBeNull()
  })

  it('niño inexistente → 42501 (no revela si existe)', async () => {
    const r = await cAdminA.rpc('quitar_foto_perfil_nino', {
      p_nino_id: '00000000-0000-4000-8000-000000000000',
    })
    expect(r.error?.code).toBe('42501')
  })

  // ------------------------------------------------- acotadas
  it('columna fuera de la lista → 22023 y nada cambia', async () => {
    const antes = await fila(ninoA.id)
    const r = await cTutorA.rpc('actualizar_familia_nino', {
      p_nino_id: ninoA.id,
      p_patch: { direccion_calle: 'X', nombre: 'Otro nombre' },
    })
    expect(r.error?.code).toBe('22023')
    expect(await fila(ninoA.id)).toEqual(antes)
  })

  it('valor que no es texto → 22023', async () => {
    const r = await cTutorA.rpc('actualizar_familia_nino', {
      p_nino_id: ninoA.id,
      p_patch: { direccion_calle: { a: 1 } },
    })
    expect(r.error?.code).toBe('22023')
  })

  it.each([
    ['de otro centro y otro niño', () => libro(centroB.id, ninoB.id)],
    ['mismo centro, otro niño', () => libro(centroA.id, ninoValidado.id)],
    ['escapa con ..', () => `${centroA.id}/${ninoA.id}/../x.pdf`],
    ['subcarpeta', () => `${centroA.id}/${ninoA.id}/sub/x.pdf`],
    ['no es pdf', () => `${centroA.id}/${ninoA.id}/x.jpg`],
  ])('libro con ruta %s → 23514 y nada cambia', async (_n, ruta) => {
    const antes = await fila(ninoA.id)
    const r = await cAdminA.rpc('fijar_libro_familia_nino', { p_nino_id: ninoA.id, p_path: ruta() })
    expect(r.error?.code).toBe('23514')
    expect(await fila(ninoA.id)).toEqual(antes)
  })

  // ------------------------------------------------- frontera de la cola (decisión J)
  it('alta validada: el tutor NO escribe directo (42501); la directora sí', async () => {
    const tutor = await cTutorA.rpc('actualizar_familia_nino', {
      p_nino_id: ninoValidado.id,
      p_patch: { direccion_calle: 'Atajo' },
    })
    expect(tutor.error?.code).toBe('42501')
    const libroTutor = await cTutorA.rpc('fijar_libro_familia_nino', {
      p_nino_id: ninoValidado.id,
      p_path: libro(centroA.id, ninoValidado.id),
    })
    expect(libroTutor.error?.code).toBe('42501')

    const directora = await cAdminA.rpc('actualizar_familia_nino', {
      p_nino_id: ninoValidado.id,
      p_patch: { direccion_calle: 'Calle validada' },
    })
    expect(directora.error).toBeNull()
    expect(await ultimoActor('ninos', ninoValidado.id)).toBe(adminA.id)
  })

  // ------------------------------------------------- flujos 3 (aplicar) por sesión
  it('aplicar un cambio pendiente con la sesión de la directora → audit con SU uid', async () => {
    const upd = await cAdminA
      .from('ninos')
      .update({ libro_familia_path: libro(centroA.id, ninoA.id, 'aprobado') })
      .eq('id', ninoA.id)
      .select('id')
      .maybeSingle()
    expect(upd.error).toBeNull()
    expect(upd.data?.id).toBe(ninoA.id)
    expect(await ultimoActor('ninos', ninoA.id)).toBe(adminA.id)

    const ftId = await crearFamiliaTutor(ninoA.familia_id, tutorA.id)
    const ft = await cAdminA
      .from('familia_tutores')
      .update({ nombre_completo: 'Titular aprobado' })
      .eq('id', ftId)
      .select('id')
      .maybeSingle()
    expect(ft.error).toBeNull()
    expect(ft.data?.id).toBe(ftId)
    expect(await ultimoActor('familia_tutores', ftId)).toBe(adminA.id)
  })
})
