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
 * F-3-D — RPC orquestadora `baja_nino` (baja intra-curso, todo-o-nada).
 *
 *  1. hijo único → niño archivado (matrícula baja, vínculos borrados) + familia
 *     inactiva + rol tutor_legal revocado.
 *  2. hermano activo → niño archivado pero familia NO revocada (guard) + roles intactos.
 *  3. motivo registrado → matriculas.motivo_baja = motivo + aparece en audit_log.
 *  4. authz → profe/tutor error; admin OK; service_role OK.
 *  5. atomicidad → fallo dentro de archivar_nino (matrícula con fecha_alta futura viola
 *     CHECK fecha_baja >= fecha_alta) → rollback total: niño NO archivado, familia intacta.
 *  6. idempotencia → baja de niño ya archivado → { ya_archivado: true }, 0 cambios.
 *
 * Gate: F3D_MIGRATION_APPLIED=1 (requiere 20260720120000 + los primitivos de F-3-C).
 */

const APPLIED = process.env.F3D_MIGRATION_APPLIED === '1'

// fecha_alta en el PASADO → fecha_baja = hoy_madrid() satisface CHECK(fecha_baja >= fecha_alta).
const ALTA_PASADA = '2025-09-01'
// fecha_alta FUTURA → al archivar (fecha_baja = hoy) viola el CHECK → fuerza el fallo.
const ALTA_FUTURA = '2030-01-01'

interface Escenario {
  centroId: string
  cursoId: string
  aulaId: string
}

describe.skipIf(!APPLIED)('F-3-D — baja_nino (RPC)', () => {
  let admin: TestUser
  let cAdmin: SupabaseClient<Database>
  const centros: string[] = []
  const usuarios: string[] = []

  beforeAll(async () => {
    admin = await createTestUser({ nombre: 'Admin F3D' })
    usuarios.push(admin.id)
    cAdmin = await clientFor(admin)
  }, 60_000)

  afterAll(async () => {
    for (const id of centros) await deleteTestCentro(id)
    for (const id of usuarios) await deleteTestUser(id)
  }, 120_000)

  async function nuevoEscenario(): Promise<Escenario> {
    const centro = await createTestCentro('Centro F3D')
    centros.push(centro.id)
    await asignarRol(admin.id, centro.id, 'admin')
    const curso = await createTestCurso(centro.id, 'activo')
    const aula = await createTestAula(centro.id, curso.id)
    return { centroId: centro.id, cursoId: curso.id, aulaId: aula.id }
  }

  /** Niño con familia + matrícula activa. Opcionalmente con un tutor (cuenta + vínculo). */
  async function crearNino(
    e: Escenario,
    opts: { fechaAlta?: string; conTutor?: boolean; familiaId?: string; nombre?: string } = {}
  ): Promise<{ ninoId: string; familiaId: string; matriculaId: string; tutor?: TestUser }> {
    const familiaId = opts.familiaId ?? (await createTestFamilia(e.centroId))
    const { data: nino } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: e.centroId,
        familia_id: familiaId,
        nombre: opts.nombre ?? 'Niño F3D',
        apellidos: 'Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    const ninoId = nino!.id
    const { data: mat } = await serviceClient
      .from('matriculas')
      .insert({
        nino_id: ninoId,
        aula_id: e.aulaId,
        curso_academico_id: e.cursoId,
        fecha_alta: opts.fechaAlta ?? ALTA_PASADA,
      })
      .select('id')
      .single()

    let tutor: TestUser | undefined
    if (opts.conTutor) {
      tutor = await createTestUser({ nombre: 'Tutor F3D' })
      usuarios.push(tutor.id)
      await asignarRol(tutor.id, e.centroId, 'tutor_legal')
      await serviceClient
        .from('familia_tutores')
        .insert({ familia_id: familiaId, usuario_id: tutor.id, rol_familia: 'titular' })
      await crearVinculo(ninoId, tutor.id, 'tutor_legal_principal')
    }
    return { ninoId, familiaId, matriculaId: mat!.id, tutor }
  }

  async function ninoArchivado(ninoId: string): Promise<boolean> {
    const { data } = await serviceClient
      .from('ninos')
      .select('deleted_at')
      .eq('id', ninoId)
      .single()
    return data!.deleted_at !== null
  }

  async function familiaInactiva(familiaId: string): Promise<boolean> {
    const { data } = await serviceClient
      .from('familias')
      .select('deleted_at')
      .eq('id', familiaId)
      .single()
    return data!.deleted_at !== null
  }

  async function rolesActivos(usuarioIds: string[]): Promise<number> {
    const { data } = await serviceClient
      .from('roles_usuario')
      .select('id')
      .eq('rol', 'tutor_legal')
      .in('usuario_id', usuarioIds)
      .is('deleted_at', null)
    return (data ?? []).length
  }

  it('hijo único → niño archivado + familia inactiva + tutor sin acceso', async () => {
    const e = await nuevoEscenario()
    const { ninoId, familiaId, matriculaId, tutor } = await crearNino(e, { conTutor: true })

    const { data, error } = await cAdmin.rpc('baja_nino', {
      p_nino_id: ninoId,
      p_motivo: 'traslado',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ archivado: true, familia_revocada: true })

    expect(await ninoArchivado(ninoId)).toBe(true)
    const { data: mat } = await serviceClient
      .from('matriculas')
      .select('estado, fecha_baja')
      .eq('id', matriculaId)
      .single()
    expect(mat!.estado).toBe('baja')
    expect(mat!.fecha_baja).not.toBeNull()

    const { data: vinc } = await serviceClient
      .from('vinculos_familiares')
      .select('deleted_at')
      .eq('nino_id', ninoId)
    expect(vinc!.every((v) => v.deleted_at !== null)).toBe(true)

    expect(await familiaInactiva(familiaId)).toBe(true)
    expect(await rolesActivos([tutor!.id])).toBe(0)
  })

  it('hermano activo → niño archivado, familia NO revocada', async () => {
    const e = await nuevoEscenario()
    const familiaId = await createTestFamilia(e.centroId)
    const baja = await crearNino(e, { familiaId, conTutor: true, nombre: 'Hermano Baja' })
    // Segundo hijo de la MISMA familia, permanece activo. Como en el alta real
    // (crear_o_anadir_a_familia crea un vínculo por niño), el hermano comparte el
    // mismo tutor de la familia vía su propio vínculo vivo.
    const activo = await crearNino(e, { familiaId, nombre: 'Hermano Activo' })
    await crearVinculo(activo.ninoId, baja.tutor!.id, 'tutor_legal_principal')

    const { data, error } = await cAdmin.rpc('baja_nino', {
      p_nino_id: baja.ninoId,
      p_motivo: 'cambio de centro',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ archivado: true, familia_revocada: false })

    expect(await ninoArchivado(baja.ninoId)).toBe(true)
    expect(await familiaInactiva(familiaId)).toBe(false) // hermano activo protege
    expect(await rolesActivos([baja.tutor!.id])).toBe(1)
  })

  it('hermano en invitación pendiente (sin vínculo) → familia NO revocada', async () => {
    // Hueco que motivó el guard por familia_id: un niño invitado activo cuyo tutor aún
    // no ha aceptado (familia_tutores.usuario_id NULL) NO tiene vínculo vivo. Dar de
    // baja a un hermano CON vínculo no debe revocar la familia: el invitado sigue activo.
    const e = await nuevoEscenario()
    const familiaId = await createTestFamilia(e.centroId)
    const conVinculo = await crearNino(e, { familiaId, conTutor: true, nombre: 'Con Vínculo' })
    // Invitación pendiente: familia_tutor sin cuenta + niño activo sin vínculo vivo.
    await serviceClient
      .from('familia_tutores')
      .insert({ familia_id: familiaId, usuario_id: null, rol_familia: 'segundo_tutor' })
    const invitado = await crearNino(e, { familiaId, nombre: 'Invitado' })

    const { data, error } = await cAdmin.rpc('baja_nino', {
      p_nino_id: conVinculo.ninoId,
      p_motivo: 'traslado',
    })
    expect(error).toBeNull()
    // Con el guard viejo (por vínculo) esto sería true (bug); con el nuevo, false.
    expect(data).toMatchObject({ archivado: true, familia_revocada: false })

    expect(await ninoArchivado(conVinculo.ninoId)).toBe(true)
    expect(await ninoArchivado(invitado.ninoId)).toBe(false) // el invitado sigue activo
    expect(await familiaInactiva(familiaId)).toBe(false) // el invitado protege por familia_id
    expect(await rolesActivos([conVinculo.tutor!.id])).toBe(1)
  })

  it('motivo registrado → matriculas.motivo_baja + audit_log', async () => {
    const e = await nuevoEscenario()
    const { ninoId, matriculaId } = await crearNino(e)
    const motivo = 'mudanza familiar'

    const { error } = await cAdmin.rpc('baja_nino', { p_nino_id: ninoId, p_motivo: motivo })
    expect(error).toBeNull()

    const { data: mat } = await serviceClient
      .from('matriculas')
      .select('motivo_baja')
      .eq('id', matriculaId)
      .single()
    expect(mat!.motivo_baja).toBe(motivo)

    // El UPDATE de la matrícula queda en audit_log con el motivo y el actor = admin.
    const { data: filas } = await serviceClient
      .from('audit_log')
      .select('usuario_id, valores_despues')
      .eq('tabla', 'matriculas')
      .eq('registro_id', matriculaId)
      .eq('accion', 'UPDATE')
    const match = (filas ?? []).find(
      (f) => (f.valores_despues as { motivo_baja?: string } | null)?.motivo_baja === motivo
    )
    expect(match).toBeDefined()
    expect(match!.usuario_id).toBe(admin.id)
  })

  it('authz: profe/tutor NO; admin SÍ; service_role SÍ', async () => {
    const e = await nuevoEscenario()
    const n1 = await crearNino(e, { conTutor: true })

    const profe = await createTestUser({ nombre: 'Profe F3D' })
    usuarios.push(profe.id)
    await asignarRol(profe.id, e.centroId, 'profe')
    const cProfe = await clientFor(profe)
    const cTutor = await clientFor(n1.tutor!)

    const rProfe = await cProfe.rpc('baja_nino', { p_nino_id: n1.ninoId, p_motivo: 'x' })
    expect(rProfe.error).not.toBeNull()
    const rTutor = await cTutor.rpc('baja_nino', { p_nino_id: n1.ninoId, p_motivo: 'x' })
    expect(rTutor.error).not.toBeNull()
    // Intentos denegados no archivaron nada.
    expect(await ninoArchivado(n1.ninoId)).toBe(false)

    // admin SÍ.
    const rAdmin = await cAdmin.rpc('baja_nino', { p_nino_id: n1.ninoId, p_motivo: 'baja admin' })
    expect(rAdmin.error).toBeNull()
    expect(await ninoArchivado(n1.ninoId)).toBe(true)

    // service_role SÍ (ruta de sistema) sobre otro niño.
    const n2 = await crearNino(e)
    const rSvc = await serviceClient.rpc('baja_nino', {
      p_nino_id: n2.ninoId,
      p_motivo: 'baja svc',
    })
    expect(rSvc.error).toBeNull()
    expect(await ninoArchivado(n2.ninoId)).toBe(true)
  })

  it('atomicidad: fallo dentro de archivar_nino → rollback total', async () => {
    const e = await nuevoEscenario()
    // Matrícula con fecha_alta FUTURA → al poner fecha_baja=hoy se viola el CHECK
    // dentro de archivar_nino → RAISE → rollback (sin bloque EXCEPTION).
    const { ninoId, familiaId, tutor } = await crearNino(e, {
      fechaAlta: ALTA_FUTURA,
      conTutor: true,
    })

    const { error } = await cAdmin.rpc('baja_nino', { p_nino_id: ninoId, p_motivo: 'fallo' })
    expect(error).not.toBeNull() // el error crudo propaga

    expect(await ninoArchivado(ninoId)).toBe(false) // nada archivado
    expect(await familiaInactiva(familiaId)).toBe(false) // familia intacta
    expect(await rolesActivos([tutor!.id])).toBe(1) // rol intacto
  })

  it('idempotencia: baja de niño ya archivado → ya_archivado, 0 cambios', async () => {
    const e = await nuevoEscenario()
    const { ninoId, familiaId } = await crearNino(e)

    const first = await cAdmin.rpc('baja_nino', { p_nino_id: ninoId, p_motivo: 'primera' })
    expect(first.error).toBeNull()
    expect(first.data).toMatchObject({ archivado: true })

    const second = await cAdmin.rpc('baja_nino', { p_nino_id: ninoId, p_motivo: 'segunda' })
    expect(second.error).toBeNull()
    expect(second.data).toMatchObject({ archivado: false, ya_archivado: true })
    // La familia ya quedó inactiva en la 1.ª; la 2.ª no la reactiva ni cambia nada.
    expect(await familiaInactiva(familiaId)).toBe(true)
  })
})
