import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F-2b-4-1 — `crear_o_anadir_a_familia` detecta familias ARCHIVADAS y las REACTIVA al
 * vuelo (un tutor con cuenta existente cuya familia se archivó —hijo único dado de baja—
 * añade un 2º hijo). Cambio quirúrgico sobre la RPC de alta (F-2b-1); los callers NO se
 * tocan (eso es F-2b-4-2/4-3). Se prueba la RPC directamente.
 *
 *  - caso2 (familia ARCHIVADA): usuario_id real + hijo nuevo → familia reactivada + rol
 *    tutor_legal revivido + niño nuevo colgado + matrícula pendiente + vínculo del hijo
 *    nuevo + resultado 'nino_anadido'. NUNCA crea familia duplicada (protege el índice único).
 *  - regresión caso1 (familia ACTIVA): 'nino_anadido', 2º niño colgado, familia y rol
 *    NO cambian de estado (no se re-tocan → 0 reactivaciones efectivas).
 *  - regresión familia nueva: tutor sin familia → 'familia_creada' (rama ELSE intacta).
 *  - atomicidad: fallo tras la reactivación (fecha_nacimiento futura viola el CHECK del
 *    niño) → rollback total: la familia NO queda reactivada a medias.
 *
 * Gate: F2B41_MIGRATION_APPLIED=1 (requiere 20260723120000 + los primitivos F-3-C/D).
 */

const APPLIED = process.env.F2B41_MIGRATION_APPLIED === '1'

const HOY_PASADO = '2024-03-15' // fecha_nacimiento válida (<= hoy).
const FUTURO = '2999-01-01' // viola CHECK (fecha_nacimiento <= CURRENT_DATE).

interface Escenario {
  centroId: string
  cursoId: string
  aulaId: string
}

describe.skipIf(!APPLIED)('F-2b-4-1 — crear_o_anadir_a_familia reactiva familia archivada', () => {
  let admin: TestUser
  let cAdmin: SupabaseClient<Database>
  const centros: string[] = []
  const usuarios: string[] = []

  beforeAll(async () => {
    admin = await createTestUser({ nombre: 'Admin F2B41' })
    usuarios.push(admin.id)
    cAdmin = await clientFor(admin)
  }, 60_000)

  afterAll(async () => {
    for (const id of centros) await deleteTestCentro(id)
    for (const id of usuarios) await deleteTestUser(id)
  }, 120_000)

  async function nuevoEscenario(): Promise<Escenario> {
    const centro = await createTestCentro('Centro F2B41')
    centros.push(centro.id)
    await asignarRol(admin.id, centro.id, 'admin')
    const curso = await createTestCurso(centro.id, 'activo')
    const aula = await createTestAula(centro.id, curso.id)
    return { centroId: centro.id, cursoId: curso.id, aulaId: aula.id }
  }

  /** Tutor con cuenta real + familia + 1 niño (matrícula pasada) + familia_tutores + vínculo. */
  async function tutorConHijo(
    e: Escenario
  ): Promise<{ tutor: TestUser; familiaId: string; ninoId: string }> {
    const tutor = await createTestUser({ nombre: 'Tutor F2B41' })
    usuarios.push(tutor.id)
    await asignarRol(tutor.id, e.centroId, 'tutor_legal')
    const familiaId = await createTestFamilia(e.centroId)
    await serviceClient
      .from('familia_tutores')
      .insert({ familia_id: familiaId, usuario_id: tutor.id, rol_familia: 'titular' })
    const { data: nino } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: e.centroId,
        familia_id: familiaId,
        nombre: 'Primer Hijo',
        apellidos: 'Test',
        fecha_nacimiento: HOY_PASADO,
      })
      .select('id')
      .single()
    const ninoId = nino!.id
    await serviceClient.from('matriculas').insert({
      nino_id: ninoId,
      aula_id: e.aulaId,
      curso_academico_id: e.cursoId,
      fecha_alta: '2025-09-01',
    })
    await crearVinculo(ninoId, tutor.id, 'tutor_legal_principal')
    return { tutor, familiaId, ninoId }
  }

  function anadirHijo(e: Escenario, tutor: TestUser, opts: { fechaNacimiento?: string } = {}) {
    return cAdmin.rpc('crear_o_anadir_a_familia', {
      p_nombre_nino: 'Segundo Hijo',
      p_apellidos_nino: 'Test',
      p_fecha_nacimiento: opts.fechaNacimiento ?? HOY_PASADO,
      p_centro_id: e.centroId,
      p_aula_id: e.aulaId,
      p_tutor_email: tutor.email,
      p_tutor_nombre_completo: 'Tutor F2B41',
      p_parentesco: 'madre',
      p_descripcion_parentesco: '',
      p_usuario_id: tutor.id,
      p_permisos: {},
    })
  }

  async function familiaArchivada(familiaId: string): Promise<boolean> {
    const { data } = await serviceClient
      .from('familias')
      .select('deleted_at')
      .eq('id', familiaId)
      .single()
    return data!.deleted_at !== null
  }

  async function rolesActivos(usuarioId: string, centroId: string): Promise<number> {
    const { data } = await serviceClient
      .from('roles_usuario')
      .select('id')
      .eq('usuario_id', usuarioId)
      .eq('centro_id', centroId)
      .eq('rol', 'tutor_legal')
      .is('deleted_at', null)
    return (data ?? []).length
  }

  async function rolDeletedAt(usuarioId: string, centroId: string): Promise<string | null> {
    const { data } = await serviceClient
      .from('roles_usuario')
      .select('deleted_at')
      .eq('usuario_id', usuarioId)
      .eq('centro_id', centroId)
      .eq('rol', 'tutor_legal')
      .single()
    return data!.deleted_at
  }

  it('caso2: familia ARCHIVADA → reactivada + rol revivido + hijo nuevo colgado', async () => {
    const e = await nuevoEscenario()
    const { tutor, familiaId, ninoId } = await tutorConHijo(e)

    // Baja del hijo único → familia archivada + rol tutor_legal revocado.
    const baja = await cAdmin.rpc('baja_nino', { p_nino_id: ninoId, p_motivo: 'traslado' })
    expect(baja.error).toBeNull()
    expect(await familiaArchivada(familiaId)).toBe(true)
    expect(await rolesActivos(tutor.id, e.centroId)).toBe(0)

    // Añadir 2º hijo con el usuario_id REAL → detecta la familia archivada y la reactiva.
    const { data, error } = await anadirHijo(e, tutor)
    expect(error).toBeNull()
    const res = data as { resultado: string; familia_id: string; nino_id: string }
    expect(res.resultado).toBe('nino_anadido') // NO 'familia_creada'
    expect(res.familia_id).toBe(familiaId) // reutiliza la MISMA familia (no duplica)

    // Familia reactivada + rol revivido.
    expect(await familiaArchivada(familiaId)).toBe(false)
    expect(await rolesActivos(tutor.id, e.centroId)).toBe(1)

    // Niño nuevo colgado de la familia + matrícula pendiente + vínculo del hijo nuevo.
    const { data: nino } = await serviceClient
      .from('ninos')
      .select('familia_id, deleted_at')
      .eq('id', res.nino_id)
      .single()
    expect(nino!.familia_id).toBe(familiaId)
    expect(nino!.deleted_at).toBeNull()
    const { data: mat } = await serviceClient
      .from('matriculas')
      .select('estado')
      .eq('nino_id', res.nino_id)
      .single()
    expect(mat!.estado).toBe('pendiente')
    const { data: vinc } = await serviceClient
      .from('vinculos_familiares')
      .select('usuario_id, deleted_at')
      .eq('nino_id', res.nino_id)
      .is('deleted_at', null)
    expect((vinc ?? []).some((v) => v.usuario_id === tutor.id)).toBe(true)

    // NO se creó una familia duplicada para ese tutor.
    const { data: fams } = await serviceClient
      .from('familia_tutores')
      .select('familia_id')
      .eq('usuario_id', tutor.id)
      .is('deleted_at', null)
    expect((fams ?? []).length).toBe(1)
  })

  it('regresión caso1: familia ACTIVA → nino_anadido, familia/rol intactos (0 reactivaciones)', async () => {
    const e = await nuevoEscenario()
    const { tutor, familiaId } = await tutorConHijo(e)
    expect(await familiaArchivada(familiaId)).toBe(false)
    const rolAntes = await rolDeletedAt(tutor.id, e.centroId) // null (vivo)

    const { data, error } = await anadirHijo(e, tutor)
    expect(error).toBeNull()
    const res = data as { resultado: string; familia_id: string }
    expect(res.resultado).toBe('nino_anadido')
    expect(res.familia_id).toBe(familiaId)

    // La familia y el rol NO cambian de estado (no se re-tocan).
    expect(await familiaArchivada(familiaId)).toBe(false)
    expect(await rolesActivos(tutor.id, e.centroId)).toBe(1)
    expect(await rolDeletedAt(tutor.id, e.centroId)).toBe(rolAntes) // sigue null → no tocado
  })

  it('regresión familia nueva: tutor sin familia → familia_creada (rama ELSE intacta)', async () => {
    const e = await nuevoEscenario()
    const tutor = await createTestUser({ nombre: 'Tutor Nuevo F2B41' })
    usuarios.push(tutor.id)
    await asignarRol(tutor.id, e.centroId, 'tutor_legal')

    const { data, error } = await anadirHijo(e, tutor)
    expect(error).toBeNull()
    const res = data as { resultado: string; familia_id: string }
    expect(res.resultado).toBe('familia_creada')
    expect(res.familia_id).not.toBeNull()
  })

  it('atomicidad: fallo tras la reactivación (fecha futura) → rollback total', async () => {
    const e = await nuevoEscenario()
    const { tutor, familiaId, ninoId } = await tutorConHijo(e)
    await cAdmin.rpc('baja_nino', { p_nino_id: ninoId, p_motivo: 'x' })
    expect(await familiaArchivada(familiaId)).toBe(true)

    // fecha_nacimiento futura → el INSERT del niño (TRAS la reactivación) viola el CHECK.
    const { error } = await anadirHijo(e, tutor, { fechaNacimiento: FUTURO })
    expect(error).not.toBeNull()

    // Rollback total: la familia NO quedó reactivada a medias, el rol sigue revocado.
    expect(await familiaArchivada(familiaId)).toBe(true)
    expect(await rolesActivos(tutor.id, e.centroId)).toBe(0)
  })
})
