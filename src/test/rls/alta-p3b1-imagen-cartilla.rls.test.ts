import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  clientFor,
  createTestCentro,
  createTestNino,
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
 * F11 · Alta tutor-driven · Pieza 3b-1 — glue backend (imagen lazy).
 *
 * Migración 20260616180000 (extiende `autorizaciones_insert` al B2 del tutor en
 * `autorizacion_imagenes`). Verifica:
 *   1. El tutor instancia (INSERT) una autorización de imagen B2 de SU hijo; un tutor
 *      ajeno NO. (La orquestación find-or-create / "sin plantilla omite" vive en la
 *      action `crearImagenAutorizacion`, no invocable en vitest → preview/3b-2.)
 *
 * (La cartilla de vacunas se eliminó en F11-F; sus tests de Storage ya no existen.)
 *
 * Gateado: F11_ALTA_P3B1_MIGRATION_APPLIED=1
 */

const APPLIED = process.env.F11_ALTA_P3B1_MIGRATION_APPLIED === '1'

describe.skipIf(!APPLIED)('Alta P3b-1 — imagen B2 (RLS)', () => {
  let centro: { id: string }
  let ninoA: { id: string }
  let ninoB: { id: string }
  let tutorA: TestUser
  let tutorB: TestUser
  let clientA: SupabaseClient<Database>
  let clientB: SupabaseClient<Database>
  let plantillaImagenId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro Alta P3b1')
    ninoA = await createTestNino(centro.id, 'Nino A P3b1')
    ninoB = await createTestNino(centro.id, 'Nino B P3b1')
    tutorA = await createTestUser({ nombre: 'Tutor A 3b1' })
    tutorB = await createTestUser({ nombre: 'Tutor B 3b1' })
    await crearVinculo(ninoA.id, tutorA.id, 'tutor_legal_principal', {})
    await crearVinculo(ninoB.id, tutorB.id, 'tutor_legal_principal', {})
    clientA = await clientFor(tutorA)
    clientB = await clientFor(tutorB)

    // Plantilla de imagen publicada del centro (gate de autorizacion_plantilla_valida).
    const { data: plantilla, error } = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'autorizacion_imagenes',
        es_plantilla: true,
        estado: 'publicada',
        texto_definitivo: true,
        titulo: 'Autorización de imagen',
        texto: 'Texto de la autorización de imagen.',
        texto_version: 'v1.0',
        creado_por: tutorA.id,
      })
      .select('id')
      .single()
    if (error || !plantilla) throw new Error(`plantilla imagen: ${error?.message}`)
    plantillaImagenId = plantilla.id
  })

  afterAll(async () => {
    await deleteTestCentro(centro.id)
    await deleteTestUser(tutorA.id)
    await deleteTestUser(tutorB.id)
  })

  // Forma de la instancia que crea `crearImagenAutorizacion` (sin la orquestación).
  function instanciaImagen(ninoId: string, creadoPor: string) {
    return {
      centro_id: centro.id,
      tipo: 'autorizacion_imagenes' as const,
      es_plantilla: false,
      plantilla_id: plantillaImagenId,
      ambito: 'nino' as const,
      nino_id: ninoId,
      titulo: 'Autorización de imagen',
      texto: 'Texto de la autorización de imagen.',
      texto_version: 'v1.0',
      texto_definitivo: true,
      estado: 'publicada' as const,
      firmantes_requeridos: 'uno_principal' as const,
      vigencia_desde: '2026-06-16',
      vigencia_hasta: null,
      creado_por: creadoPor,
    }
  }

  it('el tutor instancia la autorización de imagen B2 de SU hijo', async () => {
    const { data, error } = await clientA
      .from('autorizaciones')
      .insert(instanciaImagen(ninoA.id, tutorA.id))
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  it('un tutor ajeno NO puede instanciar la imagen de otro niño', async () => {
    const { error } = await clientB
      .from('autorizaciones')
      .insert(instanciaImagen(ninoA.id, tutorB.id))
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })
})
