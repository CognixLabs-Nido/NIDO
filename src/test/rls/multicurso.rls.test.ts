import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
 * F11-H-4 — consolidación del modelo multi-curso (cierre de F11-H).
 *
 * Verifica end-to-end el remodel de H-0/H-1/H-2/H-3 (sin lógica nueva):
 *   1. aulas físicas + aulas_curso: admin escribe, staff/familia leen,
 *      aislamiento entre centros.
 *   2. profes_aulas cualificado por curso: un profe del curso pasado NO ve las
 *      matrículas del curso activo (helpers es_profe_de_aula/es_profe_de_nino
 *      anclados a curso_activo_de_centro).
 *   3. matriculas: FK compuesta a aulas_curso, UNIQUE(nino, curso) activo,
 *      políticas admin/profe/tutor.
 *   4. lista_espera: solo admin del centro + aislamiento.
 *   5. aforo excedido al matricular: se permite (la capacidad es informativa).
 *   6. doble matrícula (activa + planificada): la planificada es invisible para
 *      staff; solo admin la ve (la familia ve la fila por tutor_select — el
 *      aislamiento operativo lo da estado='activa', no la fila de matrícula).
 *   7. "Pasar de curso" end-to-end: pendiente→activa + cierre/activación de cursos
 *      (un único curso activo por centro).
 *
 * Gateado: F11_H0_MIGRATION_APPLIED=1
 */

const APPLIED = process.env.F11_H0_MIGRATION_APPLIED === '1'

/** Añade una fila aulas_curso para un aula física ya existente en otro curso. */
async function addAulaCurso(
  centroId: string,
  aulaId: string,
  cursoId: string,
  capacidad = 12,
  tramo: number[] = [2024]
): Promise<void> {
  const { error } = await serviceClient.from('aulas_curso').insert({
    centro_id: centroId,
    aula_id: aulaId,
    curso_academico_id: cursoId,
    tramo_edad: tramo,
    capacidad,
  })
  if (error) throw new Error(`addAulaCurso: ${error.message}`)
}

async function estadoMatricula(matId: string): Promise<string | null> {
  const { data } = await serviceClient.from('matriculas').select('estado').eq('id', matId).single()
  return data?.estado ?? null
}

async function estadoCurso(cursoId: string): Promise<string | null> {
  const { data } = await serviceClient
    .from('cursos_academicos')
    .select('estado')
    .eq('id', cursoId)
    .single()
  return data?.estado ?? null
}

describe.skipIf(!APPLIED)(
  'F11-H-4 · modelo multi-curso (aulas_curso, matriculas, lista_espera)',
  () => {
    // Centro A: políticas estáticas. Centro B: aislamiento + end-to-end de activación.
    let centroA: { id: string }
    let centroB: { id: string }
    let cursoActivo: { id: string }
    let cursoSiguiente: { id: string } // planificado
    let cursoPasado: { id: string } // cerrado
    let aula: { id: string }
    let ninoActivo: { id: string }
    let matActiva: string
    let adminA: TestUser
    let profeActivo: TestUser
    let profePasado: TestUser
    let tutor: TestUser
    let adminB: TestUser
    let cAdmin: SupabaseClient<Database>
    let cProfeActivo: SupabaseClient<Database>
    let cProfePasado: SupabaseClient<Database>
    let cTutor: SupabaseClient<Database>
    let cAdminB: SupabaseClient<Database>

    beforeAll(async () => {
      centroA = await createTestCentro('Centro Multicurso A')
      centroB = await createTestCentro('Centro Multicurso B')

      // Centro A: un aula física configurada en tres cursos.
      cursoActivo = await createTestCurso(centroA.id, 'activo')
      cursoSiguiente = await createTestCurso(centroA.id, 'planificado')
      cursoPasado = await createTestCurso(centroA.id, 'cerrado')
      aula = await createTestAula(centroA.id, cursoActivo.id, 'Aula Multicurso') // crea aulas_curso del activo
      await addAulaCurso(centroA.id, aula.id, cursoSiguiente.id)
      await addAulaCurso(centroA.id, aula.id, cursoPasado.id)

      ninoActivo = await createTestNino(centroA.id, 'Nino Activo MC')
      matActiva = await matricular(ninoActivo.id, aula.id, cursoActivo.id) // estado 'activa' (helper)

      adminA = await createTestUser({ nombre: 'Admin MC A' })
      profeActivo = await createTestUser({ nombre: 'Profe Activo MC' })
      profePasado = await createTestUser({ nombre: 'Profe Pasado MC' })
      tutor = await createTestUser({ nombre: 'Tutor MC' })
      adminB = await createTestUser({ nombre: 'Admin MC B' })

      await asignarRol(adminA.id, centroA.id, 'admin')
      await asignarRol(profeActivo.id, centroA.id, 'profe')
      await asignarRol(profePasado.id, centroA.id, 'profe')
      await asignarRol(tutor.id, centroA.id, 'tutor_legal')
      await asignarRol(adminB.id, centroB.id, 'admin')

      // El profe "activo" enseña en el aula en el curso ACTIVO; el "pasado", solo en el cerrado.
      await asignarProfeAula(profeActivo.id, aula.id, cursoActivo.id)
      await asignarProfeAula(profePasado.id, aula.id, cursoPasado.id)
      await crearVinculo(ninoActivo.id, tutor.id, 'tutor_legal_principal', {})

      cAdmin = await clientFor(adminA)
      cProfeActivo = await clientFor(profeActivo)
      cProfePasado = await clientFor(profePasado)
      cTutor = await clientFor(tutor)
      cAdminB = await clientFor(adminB)
    }, 120_000)

    afterAll(async () => {
      const usuarios = [adminA?.id, profeActivo?.id, profePasado?.id, tutor?.id, adminB?.id].filter(
        (u): u is string => Boolean(u)
      )
      await serviceClient.from('vinculos_familiares').delete().in('usuario_id', usuarios)
      await serviceClient.from('profes_aulas').delete().in('profe_id', usuarios)
      await serviceClient.from('roles_usuario').delete().in('usuario_id', usuarios)
      for (const u of usuarios) await deleteTestUser(u)
      // matriculas RESTRICT a aulas_curso/ninos → borrarlas antes para que el centro cascadee.
      await serviceClient.from('matriculas').delete().eq('aula_id', aula.id)
      await deleteTestCentro(centroA.id)
      await deleteTestCentro(centroB.id)
    }, 60_000)

    // ─── 1. aulas_curso ────────────────────────────────────────────────────────
    describe('aulas_curso', () => {
      it('staff y familia del centro LEEN las aulas_curso', async () => {
        const { data: vistasProfe } = await cProfeActivo
          .from('aulas_curso')
          .select('id')
          .eq('curso_academico_id', cursoActivo.id)
        expect((vistasProfe ?? []).length).toBeGreaterThanOrEqual(1)

        const { data: vistasTutor } = await cTutor
          .from('aulas_curso')
          .select('id')
          .eq('curso_academico_id', cursoActivo.id)
        expect((vistasTutor ?? []).length).toBeGreaterThanOrEqual(1)
      })

      it('admin ESCRIBE (actualiza capacidad); el profe NO (0 filas)', async () => {
        const { data: upAdmin } = await cAdmin
          .from('aulas_curso')
          .update({ capacidad: 15 })
          .eq('aula_id', aula.id)
          .eq('curso_academico_id', cursoActivo.id)
          .select('id')
        expect((upAdmin ?? []).length).toBe(1)

        const { data: upProfe } = await cProfeActivo
          .from('aulas_curso')
          .update({ capacidad: 99 })
          .eq('aula_id', aula.id)
          .eq('curso_academico_id', cursoActivo.id)
          .select('id')
        expect(upProfe ?? []).toHaveLength(0) // RLS USING falso → 0 filas
      })

      it('aislamiento entre centros: el admin de B no ve las aulas_curso de A', async () => {
        const { data } = await cAdminB
          .from('aulas_curso')
          .select('id')
          .eq('curso_academico_id', cursoActivo.id)
        expect(data ?? []).toHaveLength(0)
      })
    })

    // ─── 2. profes_aulas cualificado por curso ───────────────────────────────────
    describe('profes_aulas cualificado por curso', () => {
      it('el profe del CURSO ACTIVO ve la matrícula activa del niño', async () => {
        const { data } = await cProfeActivo.from('matriculas').select('id').eq('id', matActiva)
        expect((data ?? []).map((m) => m.id)).toContain(matActiva)
      })

      it('el profe del CURSO PASADO NO ve la matrícula del curso activo (0 filas)', async () => {
        const { data } = await cProfePasado.from('matriculas').select('id').eq('id', matActiva)
        expect(data ?? []).toHaveLength(0)
      })
    })

    // ─── 3. matriculas: FK compuesta + UNIQUE ────────────────────────────────────
    describe('matriculas — constraints del modelo', () => {
      it('FK compuesta: matricular en (aula, curso) sin aulas_curso falla (23503)', async () => {
        const cursoHuerfano = await createTestCurso(centroA.id, 'planificado') // sin aulas_curso del aula
        const { error } = await serviceClient.from('matriculas').insert({
          nino_id: ninoActivo.id,
          aula_id: aula.id,
          curso_academico_id: cursoHuerfano.id,
          fecha_alta: '2026-09-01',
        })
        expect(error?.code).toBe('23503') // foreign_key_violation
      })

      it('UNIQUE(nino, curso) activo: segunda matrícula activa del mismo niño/curso falla (23505)', async () => {
        const { error } = await serviceClient.from('matriculas').insert({
          nino_id: ninoActivo.id,
          aula_id: aula.id,
          curso_academico_id: cursoActivo.id,
          fecha_alta: '2026-09-01',
        })
        expect(error?.code).toBe('23505') // unique_violation (idx parcial)
      })

      it('el tutor ve la matrícula de su hijo; admin también', async () => {
        const { data: t } = await cTutor.from('matriculas').select('id').eq('id', matActiva)
        expect((t ?? []).map((m) => m.id)).toContain(matActiva)
        const { data: a } = await cAdmin.from('matriculas').select('id').eq('id', matActiva)
        expect((a ?? []).map((m) => m.id)).toContain(matActiva)
      })
    })

    // ─── 4. lista_espera (solo admin) ────────────────────────────────────────────
    describe('lista_espera', () => {
      let prospectoId: string

      it('admin del centro inserta y lee un prospecto', async () => {
        const { data, error } = await cAdmin
          .from('lista_espera')
          .insert({
            centro_id: centroA.id, // lo sobrescribe el trigger; se pasa por el tipo
            curso_academico_id: cursoSiguiente.id,
            nombre_nino: 'Prospecto Demo',
            posicion: 1,
          })
          .select('id')
          .single()
        expect(error).toBeNull()
        prospectoId = data!.id
      })

      it('staff y familia NO leen la lista de espera (0 filas)', async () => {
        const { data: p } = await cProfeActivo.from('lista_espera').select('id')
        expect(p ?? []).toHaveLength(0)
        const { data: f } = await cTutor.from('lista_espera').select('id')
        expect(f ?? []).toHaveLength(0)
      })

      it('aislamiento entre centros: el admin de B no ve la lista de espera de A', async () => {
        const { data } = await cAdminB.from('lista_espera').select('id').eq('id', prospectoId)
        expect(data ?? []).toHaveLength(0)
      })
    })

    // ─── 5. aforo excedido (informativo, no bloquea) ─────────────────────────────
    describe('aforo', () => {
      it('matricular por encima de la capacidad de aulas_curso se PERMITE (aviso, no bloqueo)', async () => {
        // capacidad del aula en el curso activo = 15 (subida arriba); el aula ya tiene 1
        // matrícula. Creamos un curso nuevo con capacidad 2 y metemos 3 niños activos.
        const cursoAforo = await createTestCurso(centroA.id, 'planificado')
        await addAulaCurso(centroA.id, aula.id, cursoAforo.id, 2) // capacidad 2
        const ids: string[] = []
        for (let i = 0; i < 3; i++) {
          const n = await createTestNino(centroA.id, `Nino Aforo ${i}`)
          ids.push(await matricular(n.id, aula.id, cursoAforo.id))
        }
        expect(ids).toHaveLength(3) // 3 > capacidad 2, y aun así se insertaron
      })
    })

    // ─── 6. doble matrícula: planificada invisible para staff ────────────────────
    describe('doble matrícula (activa + planificada)', () => {
      let matPlanificada: string

      beforeAll(async () => {
        // El niño ya tiene matrícula activa en cursoActivo; le añadimos una en el
        // curso SIGUIENTE (planificado) en estado 'pendiente' (lo que hace H-2).
        const { data } = await serviceClient
          .from('matriculas')
          .insert({
            nino_id: ninoActivo.id,
            aula_id: aula.id,
            curso_academico_id: cursoSiguiente.id,
            estado: 'pendiente',
            fecha_alta: '2027-09-01',
          })
          .select('id')
          .single()
        matPlanificada = data!.id
      })

      it('el profe del curso activo NO ve la matrícula planificada (solo la activa)', async () => {
        const { data } = await cProfeActivo
          .from('matriculas')
          .select('id, estado')
          .eq('nino_id', ninoActivo.id)
        const ids = (data ?? []).map((m) => m.id)
        expect(ids).toContain(matActiva)
        expect(ids).not.toContain(matPlanificada)
      })

      it('el admin SÍ ve ambas matrículas del niño', async () => {
        const { data } = await cAdmin.from('matriculas').select('id').eq('nino_id', ninoActivo.id)
        const ids = (data ?? []).map((m) => m.id)
        expect(ids).toContain(matActiva)
        expect(ids).toContain(matPlanificada)
      })
    })
  }
)

// ─── 7. "Pasar de curso" end-to-end (centro propio, muta estados de curso) ─────
describe.skipIf(!APPLIED)('F11-H-4 · pasar de curso end-to-end', () => {
  let centro: { id: string }
  let cursoActivo: { id: string }
  let cursoSiguiente: { id: string }
  let aula: { id: string }
  let nino: { id: string }
  let matPendiente: string
  let admin: TestUser
  let cAdmin: SupabaseClient<Database>

  beforeAll(async () => {
    centro = await createTestCentro('Centro Rollover E2E')
    cursoActivo = await createTestCurso(centro.id, 'activo')
    cursoSiguiente = await createTestCurso(centro.id, 'planificado')
    aula = await createTestAula(centro.id, cursoActivo.id, 'Aula Rollover')
    await addAulaCurso(centro.id, aula.id, cursoSiguiente.id)
    nino = await createTestNino(centro.id, 'Nino Rollover')
    await matricular(nino.id, aula.id, cursoActivo.id) // activa en el curso saliente

    admin = await createTestUser({ nombre: 'Admin Rollover' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
  }, 90_000)

  afterAll(async () => {
    await serviceClient.from('roles_usuario').delete().eq('usuario_id', admin.id)
    await deleteTestUser(admin.id)
    await serviceClient.from('matriculas').delete().eq('aula_id', aula.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('admin propone una matrícula pendiente en el curso planificado', async () => {
    const { data, error } = await cAdmin
      .from('matriculas')
      .insert({
        nino_id: nino.id,
        aula_id: aula.id,
        curso_academico_id: cursoSiguiente.id,
        estado: 'pendiente',
        fecha_alta: '2027-09-01',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    matPendiente = data!.id
    expect(await estadoMatricula(matPendiente)).toBe('pendiente')
  })

  it('confirmar: flip pendiente→activa mientras el curso sigue planificado', async () => {
    const { data, error } = await cAdmin
      .from('matriculas')
      .update({ estado: 'activa' })
      .eq('id', matPendiente)
      .eq('estado', 'pendiente')
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBe(matPendiente)
    expect(await estadoMatricula(matPendiente)).toBe('activa')
  })

  it('un centro NO puede tener dos cursos activos a la vez (índice parcial único)', async () => {
    const { error } = await serviceClient
      .from('cursos_academicos')
      .update({ estado: 'activo' })
      .eq('id', cursoSiguiente.id) // cursoActivo sigue activo
    expect(error?.code).toBe('23505') // unique_violation: 1 activo por centro
  })

  it('activar curso: cerrar el saliente y activar el entrante → matrícula queda activa', async () => {
    // Orden de activarCurso: primero cerrar el activo, luego activar el siguiente.
    await serviceClient
      .from('cursos_academicos')
      .update({ estado: 'cerrado' })
      .eq('id', cursoActivo.id)
    const { error } = await serviceClient
      .from('cursos_academicos')
      .update({ estado: 'activo' })
      .eq('id', cursoSiguiente.id)
    expect(error).toBeNull()

    expect(await estadoCurso(cursoActivo.id)).toBe('cerrado')
    expect(await estadoCurso(cursoSiguiente.id)).toBe('activo')
    expect(await estadoMatricula(matPendiente)).toBe('activa')

    // El curso entrante es ahora el activo del centro.
    const { data } = await serviceClient.rpc('curso_activo_de_centro', { p_centro_id: centro.id })
    expect(data).toBe(cursoSiguiente.id)
  })
})
