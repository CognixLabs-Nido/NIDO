import { randomUUID } from 'crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

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
 * RLS + integridad de `plantillas_informe` e `informes_evolucion` (F9-0). **Gated**
 * por `F9_0_MIGRATION_APPLIED=1`: la migración
 * `20260609130000_phase9_0_informes_evolucion.sql` se aplica manualmente vía
 * Supabase SQL Editor (CLI con bug SIGILL en este Chromebook). Hasta entonces
 * estos tests se omiten para no romper la suite.
 *
 * Comando tras aplicar la migración:
 *   F9_0_MIGRATION_APPLIED=1 npm run test:rls -- informes-evolucion.rls
 *
 * Cubre los invariantes del modelo (spec docs/specs/informes-evolucion.md):
 *  - plantillas_informe: admin CRUD; staff del centro lee; familia SIN acceso;
 *    aislamiento entre centros.
 *  - informes_evolucion: coordinadora/profesora del aula crean (Q5) + gotcha MVCC
 *    `.insert().select()` (helper row-aware); tecnico/apoyo NO escriben; profe de
 *    otro centro NO escribe; admin escribe.
 *  - Lectura: staff del aula ve cualquier estado; familia ve SOLO publicados;
 *    tutor legal siempre, autorizado solo con puede_ver_datos_pedagogicos (Q7);
 *    nunca borradores; aislamiento entre aulas y entre centros.
 *  - DELETE bloqueado a todos (incluido admin).
 *
 * Cada test crea su propio niño matriculado para garantizar terna única
 * (nino, curso, periodo) sin colisiones con el UNIQUE.
 */
const MIGRATION_APPLIED = process.env.F9_0_MIGRATION_APPLIED === '1'

type PlantillaInsert = Database['public']['Tables']['plantillas_informe']['Insert']
type InformeInsert = Database['public']['Tables']['informes_evolucion']['Insert']
type TipoPersonalAula = Database['public']['Enums']['tipo_personal_aula']

const ESTRUCTURA = [
  {
    titulo: 'Autonomía',
    items: [
      { id: 'item-1', texto: 'Come solo' },
      { id: 'item-2', texto: 'Se lava las manos' },
    ],
  },
]

describe.skipIf(!MIGRATION_APPLIED)('RLS informes de evolución — F9-0', () => {
  let centro: { id: string }
  let centroB: { id: string }
  let curso: { id: string }
  let cursoB: { id: string }
  let aula: { id: string }
  let aulaB: { id: string }

  let admin: TestUser
  let coordinadora: TestUser
  let profesora: TestUser
  let tecnico: TestUser
  let coordinadoraB: TestUser // staff de centro B
  let tutor: TestUser // tutor legal (se vincula por-niño en cada test)
  let autorizadoCon: TestUser // autorizado con puede_ver_datos_pedagogicos
  let autorizadoSin: TestUser // autorizado sin el permiso
  let tutorB: TestUser // familia de centro B

  let plantilla: string // plantilla activa de centro A

  const informesCreados: string[] = []
  const plantillasCreadas: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Informes')
    centroB = await createTestCentro('Centro Informes B')
    curso = await createTestCurso(centro.id)
    cursoB = await createTestCurso(centroB.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Informes')
    aulaB = await createTestAula(centroB.id, cursoB.id, 'Aula Informes B')

    admin = await createTestUser({ nombre: 'Admin In' })
    coordinadora = await createTestUser({ nombre: 'Coord In' })
    profesora = await createTestUser({ nombre: 'Profe In' })
    tecnico = await createTestUser({ nombre: 'Tecnico In' })
    coordinadoraB = await createTestUser({ nombre: 'Coord In B' })
    tutor = await createTestUser({ nombre: 'Tutor In' })
    autorizadoCon = await createTestUser({ nombre: 'Autoriz Con' })
    autorizadoSin = await createTestUser({ nombre: 'Autoriz Sin' })
    tutorB = await createTestUser({ nombre: 'Tutor In B' })

    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(coordinadora.id, centro.id, 'profe')
    await asignarRol(profesora.id, centro.id, 'profe')
    await asignarRol(tecnico.id, centro.id, 'profe')
    await asignarRol(coordinadoraB.id, centroB.id, 'profe')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await asignarRol(autorizadoCon.id, centro.id, 'autorizado')
    await asignarRol(autorizadoSin.id, centro.id, 'autorizado')
    await asignarRol(tutorB.id, centroB.id, 'tutor_legal')

    await asignarProfeConTipo(coordinadora.id, aula.id, 'coordinadora')
    await asignarProfeConTipo(profesora.id, aula.id, 'profesora')
    await asignarProfeConTipo(tecnico.id, aula.id, 'tecnico')
    await asignarProfeConTipo(coordinadoraB.id, aulaB.id, 'coordinadora')

    plantilla = await crearPlantilla(centro.id, admin.id)
  })

  afterAll(async () => {
    for (const id of informesCreados)
      await serviceClient.from('informes_evolucion').delete().eq('id', id)
    for (const id of plantillasCreadas)
      await serviceClient.from('plantillas_informe').delete().eq('id', id)
    await deleteTestCentro(centro.id)
    await deleteTestCentro(centroB.id)
    for (const u of [
      admin,
      coordinadora,
      profesora,
      tecnico,
      coordinadoraB,
      tutor,
      autorizadoCon,
      autorizadoSin,
      tutorB,
    ])
      await deleteTestUser(u.id)
  })

  // --- helpers de creación (service role, bypass RLS) -----------------------

  async function asignarProfeConTipo(
    profe_id: string,
    aula_id: string,
    tipo: TipoPersonalAula
  ): Promise<void> {
    const { data: ac } = await serviceClient
      .from('aulas_curso')
      .select('curso_academico_id')
      .eq('aula_id', aula_id)
      .limit(1)
      .maybeSingle()
    const { error } = await serviceClient.from('profes_aulas').insert({
      profe_id,
      aula_id,
      curso_academico_id: ac!.curso_academico_id,
      fecha_inicio: '2026-09-01',
      tipo_personal_aula: tipo,
    })
    if (error) throw new Error(`asignarProfeConTipo falló: ${error.message}`)
  }

  async function crearPlantilla(centro_id: string, autor: string): Promise<string> {
    const payload: PlantillaInsert = {
      centro_id,
      titulo: `Plantilla ${randomUUID().slice(0, 8)}`,
      estructura: ESTRUCTURA,
      creado_por: autor,
    }
    const { data, error } = await serviceClient
      .from('plantillas_informe')
      .insert(payload)
      .select('id')
      .single()
    if (error || !data) throw new Error(`crearPlantilla falló: ${error?.message}`)
    plantillasCreadas.push(data.id)
    return data.id
  }

  /** Niño nuevo en centro A matriculado en aula A. Garantiza terna única por test. */
  async function nuevoNino(): Promise<string> {
    const n = await createTestNino(centro.id, `Informe Nino ${randomUUID().slice(0, 8)}`)
    await matricular(n.id, aula.id, curso.id)
    return n.id
  }

  async function crearInforme(opts: {
    nino_id: string
    centro_id: string
    plantilla_id: string
    curso_academico_id: string
    estado?: 'borrador' | 'publicado'
    autor: string
  }): Promise<string> {
    const publicado = opts.estado === 'publicado'
    const payload: InformeInsert = {
      centro_id: opts.centro_id,
      nino_id: opts.nino_id,
      curso_academico_id: opts.curso_academico_id,
      periodo: 'trimestre_1',
      plantilla_id: opts.plantilla_id,
      estructura_snapshot: ESTRUCTURA,
      respuestas: { 'item-1': { valoracion: 'conseguido' } },
      estado: opts.estado ?? 'borrador',
      publicado_at: publicado ? new Date().toISOString() : null,
      creado_por: opts.autor,
    }
    const { data, error } = await serviceClient
      .from('informes_evolucion')
      .insert(payload)
      .select('id')
      .single()
    if (error || !data) throw new Error(`crearInforme falló: ${error?.message}`)
    informesCreados.push(data.id)
    return data.id
  }

  // --- plantillas_informe ----------------------------------------------------

  it('admin crea plantilla (.insert().select() — MVCC) y la archiva', async () => {
    const c = await clientFor(admin)
    const ins = await c
      .from('plantillas_informe')
      .insert({
        centro_id: centro.id,
        titulo: 'Plantilla Admin',
        estructura: ESTRUCTURA,
        creado_por: admin.id,
      })
      .select('id')
      .maybeSingle()
    expect(ins.error).toBeNull()
    expect(ins.data?.id).toBeTruthy()
    if (ins.data?.id) plantillasCreadas.push(ins.data.id)

    const upd = await c
      .from('plantillas_informe')
      .update({
        estado: 'archivada',
        archivada_at: new Date().toISOString(),
        archivada_por: admin.id,
      })
      .eq('id', ins.data!.id)
      .select('id')
      .maybeSingle()
    expect(upd.error).toBeNull()
    expect(upd.data?.id).toBe(ins.data!.id)
  })

  it('profe (coordinadora) NO puede crear plantilla (solo dirección)', async () => {
    const c = await clientFor(coordinadora)
    const { data, error } = await c
      .from('plantillas_informe')
      .insert({
        centro_id: centro.id,
        titulo: 'Intento Profe',
        estructura: ESTRUCTURA,
        creado_por: coordinadora.id,
      })
      .select('id')
      .maybeSingle()
    expect(data).toBeNull()
    expect(error).not.toBeNull() // 42501
  })

  it('staff del centro lee plantillas; la familia NO', async () => {
    const cProfe = await clientFor(profesora)
    expect(
      (await cProfe.from('plantillas_informe').select('id').eq('id', plantilla)).data?.length
    ).toBe(1)

    const cTutor = await clientFor(tutor)
    expect(
      (await cTutor.from('plantillas_informe').select('id').eq('id', plantilla)).data?.length ?? 0
    ).toBe(0)
  })

  it('aislamiento entre centros: staff de centro B no ve plantilla de centro A', async () => {
    const cB = await clientFor(coordinadoraB)
    const { data } = await cB.from('plantillas_informe').select('id').eq('id', plantilla)
    expect(data?.length ?? 0).toBe(0)
  })

  // --- informes_evolucion: INSERT por rol + MVCC -----------------------------

  it('coordinadora crea informe de su niño (.insert().select() — MVCC row-aware)', async () => {
    const ninoId = await nuevoNino()
    const c = await clientFor(coordinadora)
    const { data, error } = await c
      .from('informes_evolucion')
      .insert({
        centro_id: centro.id,
        nino_id: ninoId,
        curso_academico_id: curso.id,
        periodo: 'trimestre_1',
        plantilla_id: plantilla,
        estructura_snapshot: ESTRUCTURA,
        creado_por: coordinadora.id,
      })
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) informesCreados.push(data.id)
  })

  it('profesora crea informe de su niño', async () => {
    const ninoId = await nuevoNino()
    const c = await clientFor(profesora)
    const { data, error } = await c
      .from('informes_evolucion')
      .insert({
        centro_id: centro.id,
        nino_id: ninoId,
        curso_academico_id: curso.id,
        periodo: 'trimestre_2',
        plantilla_id: plantilla,
        estructura_snapshot: ESTRUCTURA,
        creado_por: profesora.id,
      })
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) informesCreados.push(data.id)
  })

  it('tecnico NO puede crear informe (corte por tipo_personal_aula, Q5)', async () => {
    const ninoId = await nuevoNino()
    const c = await clientFor(tecnico)
    const { data, error } = await c
      .from('informes_evolucion')
      .insert({
        centro_id: centro.id,
        nino_id: ninoId,
        curso_academico_id: curso.id,
        periodo: 'trimestre_1',
        plantilla_id: plantilla,
        estructura_snapshot: ESTRUCTURA,
        creado_por: tecnico.id,
      })
      .select('id')
      .maybeSingle()
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('profe de otro centro NO puede crear informe del niño ajeno', async () => {
    const ninoId = await nuevoNino()
    const c = await clientFor(coordinadoraB)
    const { data, error } = await c
      .from('informes_evolucion')
      .insert({
        centro_id: centro.id,
        nino_id: ninoId,
        curso_academico_id: curso.id,
        periodo: 'trimestre_1',
        plantilla_id: plantilla,
        estructura_snapshot: ESTRUCTURA,
        creado_por: coordinadoraB.id,
      })
      .select('id')
      .maybeSingle()
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  // --- informes_evolucion: lectura por audiencia (Q7) ------------------------

  it('familia NO ve un informe en BORRADOR; el staff del aula sí (cualquier estado)', async () => {
    const ninoId = await nuevoNino()
    await crearVinculo(ninoId, tutor.id, 'tutor_legal_principal', {
      puede_ver_datos_pedagogicos: true,
    })
    const informeId = await crearInforme({
      nino_id: ninoId,
      centro_id: centro.id,
      plantilla_id: plantilla,
      curso_academico_id: curso.id,
      estado: 'borrador',
      autor: coordinadora.id,
    })

    const cTutor = await clientFor(tutor)
    expect(
      (await cTutor.from('informes_evolucion').select('id').eq('id', informeId)).data?.length ?? 0
    ).toBe(0)

    // tecnico es staff del aula → lee también borradores.
    const cTecnico = await clientFor(tecnico)
    expect(
      (await cTecnico.from('informes_evolucion').select('id').eq('id', informeId)).data?.length
    ).toBe(1)
  })

  it('PUBLICADO: tutor legal y autorizado-con-permiso lo ven; autorizado-sin-permiso NO', async () => {
    const ninoId = await nuevoNino()
    await crearVinculo(ninoId, tutor.id, 'tutor_legal_principal', {
      puede_ver_datos_pedagogicos: true,
    })
    await crearVinculo(ninoId, autorizadoCon.id, 'autorizado', {
      puede_ver_datos_pedagogicos: true,
    })
    await crearVinculo(ninoId, autorizadoSin.id, 'autorizado', {
      puede_ver_datos_pedagogicos: false,
    })
    const informeId = await crearInforme({
      nino_id: ninoId,
      centro_id: centro.id,
      plantilla_id: plantilla,
      curso_academico_id: curso.id,
      estado: 'publicado',
      autor: coordinadora.id,
    })

    const cTutor = await clientFor(tutor)
    expect(
      (await cTutor.from('informes_evolucion').select('id').eq('id', informeId)).data?.length
    ).toBe(1)

    const cCon = await clientFor(autorizadoCon)
    expect(
      (await cCon.from('informes_evolucion').select('id').eq('id', informeId)).data?.length
    ).toBe(1)

    const cSin = await clientFor(autorizadoSin)
    expect(
      (await cSin.from('informes_evolucion').select('id').eq('id', informeId)).data?.length ?? 0
    ).toBe(0)
  })

  it('aislamiento: familia de otro centro no ve el informe publicado del niño ajeno', async () => {
    const ninoId = await nuevoNino()
    const informeId = await crearInforme({
      nino_id: ninoId,
      centro_id: centro.id,
      plantilla_id: plantilla,
      curso_academico_id: curso.id,
      estado: 'publicado',
      autor: coordinadora.id,
    })
    const cB = await clientFor(tutorB)
    expect(
      (await cB.from('informes_evolucion').select('id').eq('id', informeId)).data?.length ?? 0
    ).toBe(0)
  })

  // --- informes_evolucion: UPDATE / DELETE -----------------------------------

  it('coordinadora publica (UPDATE); tecnico NO puede actualizar', async () => {
    const ninoId = await nuevoNino()
    const informeId = await crearInforme({
      nino_id: ninoId,
      centro_id: centro.id,
      plantilla_id: plantilla,
      curso_academico_id: curso.id,
      estado: 'borrador',
      autor: coordinadora.id,
    })

    const cCoord = await clientFor(coordinadora)
    const pub = await cCoord
      .from('informes_evolucion')
      .update({ estado: 'publicado', publicado_at: new Date().toISOString() })
      .eq('id', informeId)
      .select('id')
      .maybeSingle()
    expect(pub.error).toBeNull()
    expect(pub.data?.id).toBe(informeId)

    // tecnico no es redactor → su UPDATE no afecta filas (USING falso → 0 filas).
    const cTec = await clientFor(tecnico)
    const intento = await cTec
      .from('informes_evolucion')
      .update({ observaciones_generales: 'hack' })
      .eq('id', informeId)
      .select('id')
      .maybeSingle()
    expect(intento.data).toBeNull()
  })

  it('DELETE bloqueado para todos (incluido admin)', async () => {
    const ninoId = await nuevoNino()
    const informeId = await crearInforme({
      nino_id: ninoId,
      centro_id: centro.id,
      plantilla_id: plantilla,
      curso_academico_id: curso.id,
      estado: 'borrador',
      autor: admin.id,
    })
    const cAdmin = await clientFor(admin)
    await cAdmin.from('informes_evolucion').delete().eq('id', informeId)
    const sigue = await serviceClient.from('informes_evolucion').select('id').eq('id', informeId)
    expect(sigue.data?.length).toBe(1) // default DENY → no se borró
  })
})
