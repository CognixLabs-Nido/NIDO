import { randomUUID } from 'crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  assembleInformePdfData,
  loadInformeParaPdf,
} from '@/features/informes/queries/get-informe-pdf-data'

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
 * F9-4 — Control de acceso a la descarga del PDF. **Gated** por
 * `F9_0_MIGRATION_APPLIED=1` (misma migración de F9-0 ya aplicada al remoto).
 *
 * `loadInformeParaPdf(client, id)` es la frontera de autorización del route handler:
 * lee `informes_evolucion` con el cliente del usuario (RLS de F9-0) y exige
 * `estado='publicado'`. Cubre:
 *  - La familia descarga el PDF de su hijo SOLO si está publicado (borrador → null).
 *  - Aislamiento: la familia de un niño no descarga el de otro (ni de otro centro).
 *  - El staff del aula también puede descargar (caso profe/admin).
 *  - `assembleInformePdfData` resuelve centro/curso/autor (service role) tras autorizar.
 */
const MIGRATION_APPLIED = process.env.F9_0_MIGRATION_APPLIED === '1'

type InformeInsert = Database['public']['Tables']['informes_evolucion']['Insert']
type PlantillaInsert = Database['public']['Tables']['plantillas_informe']['Insert']
type TipoPersonalAula = Database['public']['Enums']['tipo_personal_aula']

const ESTRUCTURA = [{ titulo: 'Autonomía', items: [{ id: 'item-1', texto: 'Come solo' }] }]

describe.skipIf(!MIGRATION_APPLIED)('Acceso a PDF de informe — F9-4', () => {
  let centro: { id: string }
  let centroB: { id: string }
  let curso: { id: string }
  let aula: { id: string }

  let admin: TestUser
  let coordinadora: TestUser
  let tutor: TestUser
  let tutorB: TestUser
  let plantilla: string

  const informesCreados: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro PDF')
    centroB = await createTestCentro('Centro PDF B')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula PDF')

    admin = await createTestUser({ nombre: 'Admin PDF' })
    coordinadora = await createTestUser({ nombre: 'Coord PDF' })
    tutor = await createTestUser({ nombre: 'Tutor PDF' })
    tutorB = await createTestUser({ nombre: 'Tutor PDF B' })

    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(coordinadora.id, centro.id, 'profe')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await asignarRol(tutorB.id, centroB.id, 'tutor_legal')
    await asignarProfeConTipo(coordinadora.id, aula.id, 'coordinadora')

    plantilla = await crearPlantilla(centro.id, admin.id)
  })

  afterAll(async () => {
    for (const id of informesCreados)
      await serviceClient.from('informes_evolucion').delete().eq('id', id)
    await serviceClient.from('plantillas_informe').delete().eq('id', plantilla)
    await deleteTestCentro(centro.id)
    await deleteTestCentro(centroB.id)
    for (const u of [admin, coordinadora, tutor, tutorB]) await deleteTestUser(u.id)
  })

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
    return data.id
  }

  async function nuevoNino(): Promise<string> {
    const n = await createTestNino(centro.id, `PDF Nino ${randomUUID().slice(0, 8)}`)
    await matricular(n.id, aula.id, curso.id)
    return n.id
  }

  async function crearInforme(opts: {
    nino_id: string
    estado: 'borrador' | 'publicado'
  }): Promise<string> {
    const publicado = opts.estado === 'publicado'
    const payload: InformeInsert = {
      centro_id: centro.id,
      nino_id: opts.nino_id,
      curso_academico_id: curso.id,
      periodo: 'trimestre_1',
      plantilla_id: plantilla,
      estructura_snapshot: ESTRUCTURA,
      respuestas: { 'item-1': { valoracion: 'conseguido' } },
      estado: opts.estado,
      publicado_at: publicado ? new Date().toISOString() : null,
      creado_por: coordinadora.id,
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

  it('el tutor descarga el PDF de su hijo (publicado) y se resuelven los metadatos', async () => {
    const ninoId = await nuevoNino()
    await crearVinculo(ninoId, tutor.id, 'tutor_legal_principal', {
      puede_ver_datos_pedagogicos: true,
    })
    const informeId = await crearInforme({ nino_id: ninoId, estado: 'publicado' })

    const row = await loadInformeParaPdf(await clientFor(tutor), informeId)
    expect(row).not.toBeNull()
    expect(row!.estado).toBe('publicado')

    // Metadatos con service role (autor no es legible por el tutor vía RLS).
    const data = await assembleInformePdfData(serviceClient, row!)
    expect(data.centroNombre).toBe('Centro PDF')
    expect(data.autorNombre).toBe('Coord PDF')
    expect(data.ninoNombre).toContain('PDF Nino')
  })

  it('el tutor NO descarga un informe en borrador de su hijo', async () => {
    const ninoId = await nuevoNino()
    await crearVinculo(ninoId, tutor.id, 'tutor_legal_principal', {
      puede_ver_datos_pedagogicos: true,
    })
    const informeId = await crearInforme({ nino_id: ninoId, estado: 'borrador' })

    const row = await loadInformeParaPdf(await clientFor(tutor), informeId)
    expect(row).toBeNull()
  })

  it('aislamiento: la familia de otro centro no descarga el PDF del niño ajeno', async () => {
    const ninoId = await nuevoNino()
    const informeId = await crearInforme({ nino_id: ninoId, estado: 'publicado' })

    const row = await loadInformeParaPdf(await clientFor(tutorB), informeId)
    expect(row).toBeNull()
  })

  it('el staff del aula (coordinadora) también puede descargar el PDF publicado', async () => {
    const ninoId = await nuevoNino()
    const informeId = await crearInforme({ nino_id: ninoId, estado: 'publicado' })

    const row = await loadInformeParaPdf(await clientFor(coordinadora), informeId)
    expect(row).not.toBeNull()
  })
})
