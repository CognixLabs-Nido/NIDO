import { createHash } from 'crypto'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

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

/**
 * RLS del modelo CORREGIDO (F8-RW-0): catálogo (plantilla durable) + dos patrones
 * de iniciación A/B. **Gated** por `F8_RW0_MIGRATION_APPLIED=1`: la migración
 * `20260607120000_phase8_rw0_catalogo.sql` se aplica manualmente vía SQL Editor.
 *
 *   F8_RW0_MIGRATION_APPLIED=1 npm run test:rls -- autorizaciones-rw0.rls
 *
 * Cubre lo nuevo del rework (decisiones 2026-06-07, B2):
 *  - **Plantilla durable** (es_plantilla=true): legible por miembros del centro;
 *    índice único (una activa por centro+tipo); **NO firmable** (catálogo).
 *  - **Patrón B2**: el TUTOR crea una instancia (recogida/medicación) de SU hijo
 *    desde la plantilla publicada y la firma (MVCC `.insert().select()`). Acotado:
 *    niño ajeno / sin plantilla / plantilla de otro centro → denegado.
 *  - **Patrón A**: admin ENVÍA reglas a una audiencia (ambito=aula) → el tutor de
 *    un niño de esa aula puede firmar (autorizacion_aplica_a_nino vía matrículas).
 *  - **Congelar identidad** (ambito/plantilla_id) tras la primera firma; anular sí.
 *  - **Compat legacy**: una recogida del modelo viejo (plantilla_id NULL, nino_id)
 *    sigue siendo válida y firmable por su tutor.
 */
const MIGRATION_APPLIED = process.env.F8_RW0_MIGRATION_APPLIED === '1'

const TEXTO_REAL = 'Autorizo en las condiciones descritas. Texto legal real del formato estándar.'
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const SVG_TRAZO = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/></svg>'

type AutorizacionInsert = Database['public']['Tables']['autorizaciones']['Insert']
type FirmaInsert = Database['public']['Tables']['firmas_autorizacion']['Insert']
type TipoAutorizacion = Database['public']['Enums']['tipo_autorizacion']
type Ambito = Database['public']['Enums']['autorizacion_ambito']

describe.skipIf(!MIGRATION_APPLIED)('RLS autorizaciones — F8-RW-0 (catálogo + A/B2)', () => {
  let centro: { id: string }
  let centroB: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let profe: TestUser
  let tutor: TestUser // tutor de `nino` en `centro`
  let tutorB: TestUser // tutor de `ninoB` en `centroB`
  let nino: { id: string }
  let ninoB: { id: string }

  const autorizacionesCreadas: string[] = []
  const firmasCreadas: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro RW0')
    centroB = await createTestCentro('Centro RW0 B')
    const curso = await createTestCurso(centro.id)
    const cursoB = await createTestCurso(centroB.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula RW0')
    const aulaB = await createTestAula(centroB.id, cursoB.id, 'Aula RW0 B')
    nino = await createTestNino(centro.id, 'RW0 Nino')
    ninoB = await createTestNino(centroB.id, 'RW0 Nino B')
    await matricular(nino.id, aula.id, curso.id)
    await matricular(ninoB.id, aulaB.id, cursoB.id)

    admin = await createTestUser({ nombre: 'Admin RW0' })
    profe = await createTestUser({ nombre: 'Profe RW0' })
    tutor = await createTestUser({ nombre: 'Tutor RW0' })
    tutorB = await createTestUser({ nombre: 'Tutor RW0 B' })

    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await asignarRol(tutorB.id, centroB.id, 'tutor_legal')
    await asignarProfeAula(profe.id, aula.id)
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
      puede_firmar_autorizaciones: true,
    })
    await crearVinculo(ninoB.id, tutorB.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
      puede_firmar_autorizaciones: true,
    })
  })

  // Aislamiento entre tests: el índice único `idx_autorizaciones_plantilla_unica`
  // solo admite UNA plantilla activa por (centro,tipo) → cada test debe limpiar sus
  // filas o la siguiente plantilla del mismo tipo choca. Se borra en orden INVERSO
  // (instancias antes que su plantilla: plantilla_id es ON DELETE RESTRICT).
  afterEach(async () => {
    for (const id of firmasCreadas.splice(0).reverse())
      await serviceClient.from('firmas_autorizacion').delete().eq('id', id)
    for (const id of autorizacionesCreadas.splice(0).reverse())
      await serviceClient.from('autorizaciones').delete().eq('id', id)
  })

  afterAll(async () => {
    await deleteTestCentro(centro.id)
    await deleteTestCentro(centroB.id)
    for (const u of [admin, profe, tutor, tutorB]) await deleteTestUser(u.id)
  })

  // --- helpers (service role, bypass RLS) -----------------------------------

  /** Plantilla durable de catálogo (es_plantilla=true), publicada y definitiva. */
  async function crearPlantilla(tipo: TipoAutorizacion, centroId = centro.id): Promise<string> {
    const payload: AutorizacionInsert = {
      centro_id: centroId,
      tipo,
      es_plantilla: true,
      titulo: `Formato ${tipo}`,
      texto: TEXTO_REAL,
      texto_version: 'v1',
      texto_definitivo: true,
      estado: 'publicada',
      creado_por: admin.id,
    }
    const { data, error } = await serviceClient
      .from('autorizaciones')
      .insert(payload)
      .select('id')
      .single()
    if (error || !data) throw new Error(`crearPlantilla(${tipo}) falló: ${error?.message}`)
    autorizacionesCreadas.push(data.id)
    return data.id
  }

  function firmaPayload(
    user: TestUser,
    autorizacion_id: string,
    nino_id: string,
    decision: Database['public']['Enums']['firma_decision'] = 'firmado',
    datos: unknown = {}
  ): FirmaInsert {
    return {
      autorizacion_id,
      nino_id,
      firmante_id: user.id,
      rol_firmante: 'tutor_legal_principal',
      decision,
      texto_hash: sha256(TEXTO_REAL),
      texto_version: 'v1',
      nombre_tecleado: 'Firmante RW0',
      firma_imagen: decision === 'firmado' ? SVG_TRAZO : null,
      datos: datos as FirmaInsert['datos'],
    }
  }

  // === Plantilla durable (catálogo) =========================================

  it('plantilla durable: una activa por (centro,tipo); la 2ª choca con el índice único', async () => {
    await crearPlantilla('recogida')
    const segunda = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'recogida',
        es_plantilla: true,
        titulo: 'Otra recogida',
        texto: TEXTO_REAL,
        texto_version: 'v2',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      .select('id')
      .maybeSingle()
    expect(segunda.error, 'una 2ª plantilla activa del mismo tipo debe fallar').not.toBeNull()
    expect(segunda.data?.id).toBeFalsy()
  })

  it('plantilla durable es legible por un miembro del centro (catálogo); no por otro centro', async () => {
    const plantilla = await crearPlantilla('medicacion')

    const cTutor = await clientFor(tutor)
    const { data: visto } = await cTutor.from('autorizaciones').select('id').eq('id', plantilla)
    expect(visto?.length, 'el tutor del centro ve el formato del catálogo').toBe(1)

    const cOtro = await clientFor(tutorB)
    const { data: noVisto } = await cOtro.from('autorizaciones').select('id').eq('id', plantilla)
    expect(noVisto?.length ?? 0).toBe(0)
  })

  it('una plantilla NO es firmable directamente (se firma la instancia — B2)', async () => {
    const plantilla = await crearPlantilla('recogida', centroB.id) // del centroB para no chocar índice
    // tutorB es del centroB; intenta firmar la plantilla directamente.
    const c = await clientFor(tutorB)
    const r = await c
      .from('firmas_autorizacion')
      .insert(firmaPayload(tutorB, plantilla, ninoB.id))
      .select('id')
      .maybeSingle()
    expect(
      r.data?.id,
      'firmar el catálogo debe denegarse (autorizacion_firmable=false)'
    ).toBeFalsy()
  })

  // === Patrón B2: el tutor crea instancia desde la plantilla y firma =========

  it('B2: el tutor crea una instancia de recogida de su hijo desde la plantilla y la firma (MVCC)', async () => {
    const plantilla = await crearPlantilla('recogida')
    const c = await clientFor(tutor)

    const inst = await c
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'recogida',
        es_plantilla: false,
        plantilla_id: plantilla,
        ambito: 'nino' as Ambito,
        nino_id: nino.id,
        titulo: 'Mi recogida habitual',
        texto: TEXTO_REAL,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: tutor.id,
      })
      .select('id')
      .maybeSingle()
    expect(inst.error, 'el tutor debe poder crear su instancia B2').toBeNull()
    expect(inst.data?.id).toBeTruthy()
    if (inst.data?.id) autorizacionesCreadas.push(inst.data.id)

    const firma = await c
      .from('firmas_autorizacion')
      .insert(
        firmaPayload(tutor, inst.data!.id, nino.id, 'firmado', {
          personas: [{ nombre: 'Ana Pérez', dni: '12345678Z', parentesco: 'abuela' }],
        })
      )
      .select('id, datos')
      .maybeSingle()
    expect(firma.error).toBeNull()
    expect(firma.data?.id).toBeTruthy()
    // la lista viaja con la firma (MVCC `.insert().select()`).
    expect((firma.data?.datos as { personas?: unknown[] })?.personas?.length).toBe(1)
    if (firma.data?.id) firmasCreadas.push(firma.data.id)
  })

  it('B2 acotado: el tutor NO crea instancia para un niño ajeno, ni sin plantilla, ni con plantilla de otro centro', async () => {
    const plantillaB = await crearPlantilla('medicacion', centroB.id)
    const c = await clientFor(tutor)

    const base = {
      tipo: 'medicacion' as TipoAutorizacion,
      es_plantilla: false,
      ambito: 'nino' as Ambito,
      titulo: 'Med',
      texto: TEXTO_REAL,
      texto_version: 'v1',
      texto_definitivo: true,
      estado: 'publicada' as const,
      creado_por: tutor.id,
    }

    // (a) niño ajeno (ninoB) → es_tutor_de(ninoB)=false.
    const ajeno = await c
      .from('autorizaciones')
      .insert({ ...base, centro_id: centroB.id, plantilla_id: plantillaB, nino_id: ninoB.id })
      .select('id')
      .maybeSingle()
    expect(ajeno.data?.id, 'instancia para niño ajeno debe denegarse').toBeFalsy()

    // (b) sin plantilla_id → el tutor no puede crear la forma legacy (RLS exige plantilla).
    const sinPlantilla = await c
      .from('autorizaciones')
      .insert({ ...base, centro_id: centro.id, nino_id: nino.id })
      .select('id')
      .maybeSingle()
    expect(sinPlantilla.data?.id, 'sin plantilla_id el tutor no inserta').toBeFalsy()

    // (c) plantilla de otro centro/tipo → autorizacion_plantilla_valida=false.
    const plantillaAjena = await c
      .from('autorizaciones')
      .insert({ ...base, centro_id: centro.id, plantilla_id: plantillaB, nino_id: nino.id })
      .select('id')
      .maybeSingle()
    expect(plantillaAjena.data?.id, 'plantilla de otro centro debe denegarse').toBeFalsy()
  })

  // === Patrón A: admin ENVÍA a una audiencia (ambito=aula) ===================

  it('A: admin envía reglas a un aula; el tutor de un niño de esa aula puede firmar', async () => {
    const plantilla = await crearPlantilla('reglas_regimen_interno')
    const cAdmin = await clientFor(admin)

    const inst = await cAdmin
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'reglas_regimen_interno',
        es_plantilla: false,
        plantilla_id: plantilla,
        ambito: 'aula' as Ambito,
        aula_id: aula.id,
        titulo: 'Normas del aula',
        texto: TEXTO_REAL,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      .select('id')
      .maybeSingle()
    expect(inst.error, 'admin debe poder enviar a un aula').toBeNull()
    expect(inst.data?.id).toBeTruthy()
    if (inst.data?.id) autorizacionesCreadas.push(inst.data.id)

    // el tutor de un niño matriculado en el aula firma (aplica vía matrículas).
    const cTutor = await clientFor(tutor)
    const firma = await cTutor
      .from('firmas_autorizacion')
      .insert(firmaPayload(tutor, inst.data!.id, nino.id))
      .select('id')
      .maybeSingle()
    expect(firma.error, 'el tutor del aula debe poder firmar la instancia A').toBeNull()
    expect(firma.data?.id).toBeTruthy()
    if (firma.data?.id) firmasCreadas.push(firma.data.id)
  })

  // === Congelar identidad tras la primera firma ==============================

  it('con una firma, no se puede cambiar ambito/plantilla_id (trigger); anular sí', async () => {
    const plantilla = await crearPlantilla('recogida')
    const cTutor = await clientFor(tutor)
    const inst = await cTutor
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'recogida',
        es_plantilla: false,
        plantilla_id: plantilla,
        ambito: 'nino' as Ambito,
        nino_id: nino.id,
        titulo: 'Recogida congelar',
        texto: TEXTO_REAL,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: tutor.id,
      })
      .select('id')
      .single()
    if (inst.error) throw new Error(`crear instancia congelar falló: ${inst.error.message}`)
    autorizacionesCreadas.push(inst.data.id)
    const firma = await cTutor
      .from('firmas_autorizacion')
      .insert(firmaPayload(tutor, inst.data.id, nino.id))
      .select('id')
      .single()
    if (!firma.error && firma.data) firmasCreadas.push(firma.data.id)

    // cambiar plantilla_id a NULL tras firmar → el trigger lanza (service role no salta triggers).
    const cambio = await serviceClient
      .from('autorizaciones')
      .update({ plantilla_id: null, ambito: null })
      .eq('id', inst.data.id)
    expect(cambio.error, 'congelar identidad: el trigger debe impedir el cambio').not.toBeNull()

    // anular (estado) sí se permite (no altera lo consentido).
    const anular = await serviceClient
      .from('autorizaciones')
      .update({ estado: 'anulada' })
      .eq('id', inst.data.id)
      .select('estado')
      .maybeSingle()
    expect(anular.error).toBeNull()
    expect(anular.data?.estado).toBe('anulada')
  })

  // === Compat: las filas legacy del modelo viejo siguen válidas ==============

  it('compat legacy: una recogida sin plantilla_id (modelo viejo) sigue siendo firmable por su tutor', async () => {
    // forma legacy (form 5 del CHECK): es_plantilla=false, plantilla_id NULL, nino_id.
    const legacy = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'recogida',
        es_plantilla: false,
        nino_id: nino.id,
        titulo: 'Recogida legacy',
        texto: TEXTO_REAL,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    expect(legacy.error, 'la forma legacy debe seguir siendo válida (CHECK relajado)').toBeNull()
    if (legacy.error || !legacy.data)
      throw new Error(`recogida legacy falló: ${legacy.error?.message}`)
    autorizacionesCreadas.push(legacy.data.id)

    const cTutor = await clientFor(tutor)
    const firma = await cTutor
      .from('firmas_autorizacion')
      .insert(firmaPayload(tutor, legacy.data.id, nino.id))
      .select('id')
      .maybeSingle()
    expect(firma.error).toBeNull()
    expect(firma.data?.id, 'el tutor firma su recogida legacy').toBeTruthy()
    if (firma.data?.id) firmasCreadas.push(firma.data.id)
  })
})
