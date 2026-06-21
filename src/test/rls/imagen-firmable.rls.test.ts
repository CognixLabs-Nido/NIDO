import { createHash } from 'crypto'

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
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * RLS Fase 11-A3 (RGPD) — Consentimiento de imagen firmable vía la firma de F8.
 *
 * Spec: docs/specs/proteccion-datos.md (Decisión #9) + D1–D5. Migración:
 * 20260614120000_phase11a3_imagen_firmable (helper imagen_consentida + trigger
 * firma_imagen_sync AFTER INSERT en firmas_autorizacion).
 *
 * Verifica el MECANISMO: al firmar `autorizacion_imagenes`, una única escritura
 * (la firma) activa atómicamente el flag `ninos.puede_aparecer_en_fotos` y la fila
 * de `consentimientos` tipo=imagen (versión = texto_version, usuario = firmante);
 * revocación simétrica; agregación uno/ambos firmantes; acotamiento a imágenes.
 *
 * Gateado por flag (migración a mano vía SQL Editor — CLI SIGILL):
 *   F11A3_IMAGEN_MIGRATION_APPLIED=1
 */

type AutorizacionInsert = Database['public']['Tables']['autorizaciones']['Insert']
type FirmaInsert = Database['public']['Tables']['firmas_autorizacion']['Insert']
type Ambito = Database['public']['Enums']['autorizacion_ambito']
type PoliticaFirmantes = Database['public']['Enums']['politica_firmantes']

const MIGRATION_APPLIED = process.env.F11A3_IMAGEN_MIGRATION_APPLIED === '1'

const TEXTO_REAL = 'Autorizo el uso de la imagen del menor en las condiciones descritas.'
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const SVG_TRAZO = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/></svg>'

describe.skipIf(!MIGRATION_APPLIED)('RLS imagen firmable — F11-A3', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let ninoUno: { id: string } // 1 tutor principal (política uno_principal)
  let ninoAmbos: { id: string } // 2 tutores principales + requiere_ambos_firmantes
  let admin: TestUser
  let tutorUno: TestUser
  let tutorA: TestUser
  let tutorB: TestUser

  let plantillaImagenes: string
  let plantillaRecogida: string

  const autorizacionesCreadas: string[] = []

  async function crearPlantilla(tipo: Database['public']['Enums']['tipo_autorizacion']) {
    const payload: AutorizacionInsert = {
      centro_id: centro.id,
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

  /** Instancia patrón A (dirección publica; el tutor firma), ámbito niño. */
  async function crearInstanciaImagenes(
    ninoId: string,
    version: string,
    firmantes: PoliticaFirmantes = 'uno_principal'
  ): Promise<string> {
    const { data, error } = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'autorizacion_imagenes',
        es_plantilla: false,
        plantilla_id: plantillaImagenes,
        ambito: 'nino' as Ambito,
        nino_id: ninoId,
        firmantes_requeridos: firmantes,
        titulo: 'Autorización de imágenes',
        texto: TEXTO_REAL,
        texto_version: version,
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`crearInstanciaImagenes falló: ${error?.message}`)
    autorizacionesCreadas.push(data.id)
    return data.id
  }

  function firmaPayload(
    user: TestUser,
    autorizacion_id: string,
    nino_id: string,
    version: string,
    decision: Database['public']['Enums']['firma_decision'] = 'firmado'
  ): FirmaInsert {
    return {
      autorizacion_id,
      nino_id,
      firmante_id: user.id,
      rol_firmante: 'tutor_legal_principal',
      decision,
      texto_hash: sha256(TEXTO_REAL),
      texto_version: version,
      nombre_tecleado: 'Tutor Imagen',
      firma_imagen: decision === 'firmado' ? SVG_TRAZO : null,
    }
  }

  async function flagDe(ninoId: string): Promise<boolean | null> {
    const { data } = await serviceClient
      .from('ninos')
      .select('puede_aparecer_en_fotos')
      .eq('id', ninoId)
      .single()
    return data?.puede_aparecer_en_fotos ?? null
  }

  async function consentsImagen(userId: string) {
    const { data } = await serviceClient
      .from('consentimientos')
      .select('version, revocado_en')
      .eq('usuario_id', userId)
      .eq('tipo', 'imagen')
      .order('aceptado_en', { ascending: false })
    return data ?? []
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro IMG')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula IMG')
    ninoUno = await createTestNino(centro.id, 'Niño IMG Uno')
    ninoAmbos = await createTestNino(centro.id, 'Niño IMG Ambos')
    await matricular(ninoUno.id, aula.id, curso.id)
    await matricular(ninoAmbos.id, aula.id, curso.id)
    // ninoAmbos exige doble firma.
    await serviceClient
      .from('ninos')
      .update({ requiere_ambos_firmantes: true })
      .eq('id', ninoAmbos.id)

    admin = await createTestUser({ nombre: 'Admin IMG' })
    await asignarRol(admin.id, centro.id, 'admin')

    tutorUno = await createTestUser({ nombre: 'Tutor IMG Uno' })
    await asignarRol(tutorUno.id, centro.id, 'tutor_legal')
    await crearVinculo(ninoUno.id, tutorUno.id, 'tutor_legal_principal', {
      puede_firmar_autorizaciones: true,
    })

    tutorA = await createTestUser({ nombre: 'Tutor IMG A' })
    await asignarRol(tutorA.id, centro.id, 'tutor_legal')
    await crearVinculo(ninoAmbos.id, tutorA.id, 'tutor_legal_principal', {
      puede_firmar_autorizaciones: true,
    })

    tutorB = await createTestUser({ nombre: 'Tutor IMG B' })
    await asignarRol(tutorB.id, centro.id, 'tutor_legal')
    await crearVinculo(ninoAmbos.id, tutorB.id, 'tutor_legal_principal', {
      puede_firmar_autorizaciones: true,
    })

    plantillaImagenes = await crearPlantilla('autorizacion_imagenes')
    plantillaRecogida = await crearPlantilla('recogida')
  }, 240_000)

  afterAll(async () => {
    const usuarios = [admin?.id, tutorUno?.id, tutorA?.id, tutorB?.id].filter((u): u is string =>
      Boolean(u)
    )
    await serviceClient.from('consentimientos').delete().in('usuario_id', usuarios)
    for (const id of autorizacionesCreadas) {
      await serviceClient.from('firmas_autorizacion').delete().eq('autorizacion_id', id)
    }
    // Instancias antes que su plantilla (plantilla_id ON DELETE RESTRICT).
    await serviceClient
      .from('autorizaciones')
      .delete()
      .eq('es_plantilla', false)
      .in('id', autorizacionesCreadas)
    await serviceClient.from('autorizaciones').delete().in('id', autorizacionesCreadas)
    await serviceClient.from('matriculas').delete().in('nino_id', [ninoUno.id, ninoAmbos.id])
    await serviceClient.from('vinculos_familiares').delete().in('usuario_id', usuarios)
    await serviceClient.from('roles_usuario').delete().in('usuario_id', usuarios)
    for (const u of usuarios) await deleteTestUser(u)
  }, 120_000)

  // -------------------------------------------------------------------
  // i01 — firmar imágenes (uno_principal) → flag true + consent imagen vigente
  // -------------------------------------------------------------------
  it('i01 — firmar activa el flag y registra el consentimiento (versión = texto_version, usuario = firmante)', async () => {
    const inst = await crearInstanciaImagenes(ninoUno.id, 'v1')
    expect(await flagDe(ninoUno.id)).toBe(false)

    const c = await clientFor(tutorUno)
    const { error } = await c
      .from('firmas_autorizacion')
      .insert(firmaPayload(tutorUno, inst, ninoUno.id, 'v1'))
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()

    expect(await flagDe(ninoUno.id)).toBe(true)
    const consents = await consentsImagen(tutorUno.id)
    const vigente = consents.find((x) => x.revocado_en === null)
    expect(vigente?.version).toBe('v1') // D2: texto_version
  })

  // -------------------------------------------------------------------
  // i02 — revocar la firma → flag false + consent imagen revocado
  // -------------------------------------------------------------------
  it('i02 — revocar la firma apaga el flag y revoca el consentimiento del firmante', async () => {
    const inst = await crearInstanciaImagenes(ninoUno.id, 'v1')
    const c = await clientFor(tutorUno)
    await c.from('firmas_autorizacion').insert(firmaPayload(tutorUno, inst, ninoUno.id, 'v1'))
    expect(await flagDe(ninoUno.id)).toBe(true)

    const { error } = await c
      .from('firmas_autorizacion')
      .insert(firmaPayload(tutorUno, inst, ninoUno.id, 'v1', 'revocado'))
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()

    expect(await flagDe(ninoUno.id)).toBe(false)
    const consents = await consentsImagen(tutorUno.id)
    expect(consents.every((x) => x.revocado_en !== null)).toBe(true) // ninguno vigente
  })

  // -------------------------------------------------------------------
  // i03 — doble firmante: hace falta A y B; revocar uno apaga (D4)
  // -------------------------------------------------------------------
  it('i03 — requiere_ambos: un solo firmante NO basta; ambos sí; revocar uno apaga', async () => {
    const inst = await crearInstanciaImagenes(ninoAmbos.id, 'v1', 'todos_los_principales')
    const cA = await clientFor(tutorA)
    const cB = await clientFor(tutorB)

    await cA.from('firmas_autorizacion').insert(firmaPayload(tutorA, inst, ninoAmbos.id, 'v1'))
    expect(await flagDe(ninoAmbos.id), 'solo A → falta B').toBe(false)

    await cB.from('firmas_autorizacion').insert(firmaPayload(tutorB, inst, ninoAmbos.id, 'v1'))
    expect(await flagDe(ninoAmbos.id), 'A y B → consentido').toBe(true)

    await cB
      .from('firmas_autorizacion')
      .insert(firmaPayload(tutorB, inst, ninoAmbos.id, 'v1', 'revocado'))
    expect(await flagDe(ninoAmbos.id), 'B revoca → se apaga').toBe(false)
  })

  // -------------------------------------------------------------------
  // i04 — re-firma con versión nueva = re-consentimiento (fila nueva vigente)
  // -------------------------------------------------------------------
  it('i04 — re-firmar una instancia con versión nueva supersede el consentimiento', async () => {
    const instV2 = await crearInstanciaImagenes(ninoUno.id, 'v2')
    const c = await clientFor(tutorUno)
    const { error } = await c
      .from('firmas_autorizacion')
      .insert(firmaPayload(tutorUno, instV2, ninoUno.id, 'v2'))
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()

    expect(await flagDe(ninoUno.id)).toBe(true)
    const consents = await consentsImagen(tutorUno.id)
    const vigentes = consents.filter((x) => x.revocado_en === null)
    expect(vigentes).toHaveLength(1) // una sola vigente (supersede)
    expect(vigentes[0]?.version).toBe('v2')
  })

  // -------------------------------------------------------------------
  // i05 — el trigger NO toca otros tipos (recogida)
  // -------------------------------------------------------------------
  it('i05 — firmar una recogida NO altera el flag ni crea consentimiento de imagen', async () => {
    // Niño nuevo sin firmas de imagen → flag false de base.
    const ninoR = await createTestNino(centro.id, 'Niño IMG Recogida')
    await matricular(ninoR.id, aula.id, curso.id)
    const tutorR = await createTestUser({ nombre: 'Tutor IMG R' })
    await asignarRol(tutorR.id, centro.id, 'tutor_legal')
    await crearVinculo(ninoR.id, tutorR.id, 'tutor_legal_principal', {
      puede_firmar_autorizaciones: true,
    })

    const { data: inst } = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'recogida',
        es_plantilla: false,
        plantilla_id: plantillaRecogida,
        ambito: 'nino' as Ambito,
        nino_id: ninoR.id,
        titulo: 'Recogida',
        texto: TEXTO_REAL,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    autorizacionesCreadas.push(inst!.id)

    const c = await clientFor(tutorR)
    await c.from('firmas_autorizacion').insert({
      ...firmaPayload(tutorR, inst!.id, ninoR.id, 'v1'),
      datos: { personas: [{ nombre: 'Ana', dni: '12345678Z' }] } as FirmaInsert['datos'],
    })

    expect(await flagDe(ninoR.id), 'recogida no toca el flag de imagen').toBe(false)
    expect(await consentsImagen(tutorR.id), 'recogida no crea consent imagen').toHaveLength(0)

    // limpieza local
    await serviceClient.from('firmas_autorizacion').delete().eq('nino_id', ninoR.id)
    await serviceClient.from('matriculas').delete().eq('nino_id', ninoR.id)
    await serviceClient.from('vinculos_familiares').delete().eq('usuario_id', tutorR.id)
    await serviceClient.from('roles_usuario').delete().eq('usuario_id', tutorR.id)
    await deleteTestUser(tutorR.id)
  })
})
