import { createHash } from 'crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarRol,
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

/**
 * El consentimiento de imagen solo lo da el tutor LEGAL (o Dirección en firma presencial).
 *
 * Migración: 20261002120000_fix_consent_imagen_solo_tutor_legal
 *   - otorgar/revocar_consentimiento_imagen: `es_tutor_de` → `es_tutor_legal_de`.
 *   - firma_imagen_sync: la firma `firmado` del documento de imagen solo genera
 *     consentimiento si el firmante es tutor legal de ese niño (o Dirección presencial).
 *
 * Un vínculo `autorizado` (persona de recogida) no puede otorgar ni revocar por las RPCs, y
 * aunque tenga `puede_firmar_autorizaciones` y firme el documento, no genera consentimiento.
 * La firma presencial de Dirección no se puede provocar desde PostgREST (la deriva el server
 * action); quedó cubierta por el ensayo con rollback contra el remoto.
 *
 * Gateado (la migración la aplica Jose a mano): CONSENT_IMAGEN_TUTOR_LEGAL_APPLIED=1
 */

type FirmaInsert = Database['public']['Tables']['firmas_autorizacion']['Insert']

const MIGRATION_APPLIED = process.env.CONSENT_IMAGEN_TUTOR_LEGAL_APPLIED === '1'

const TEXTO = 'Autorizo el uso de la imagen del menor en las condiciones descritas.'
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const SVG_TRAZO = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/></svg>'

describe.skipIf(!MIGRATION_APPLIED)('Consentimiento de imagen — solo el tutor legal', () => {
  let centro: { id: string }
  let nino: { id: string }
  let admin: TestUser
  let tutor: TestUser
  let autorizado: TestUser
  let plantilla: string
  let instancia: string

  const vigente = async (usuarioId: string): Promise<boolean> => {
    const { data } = await serviceClient
      .from('consentimientos')
      .select('id')
      .eq('tipo', 'imagen')
      .eq('nino_id', nino.id)
      .eq('usuario_id', usuarioId)
      .is('revocado_en', null)
    return (data ?? []).length > 0
  }
  const firma = (user: TestUser, rol: FirmaInsert['rol_firmante']): FirmaInsert => ({
    autorizacion_id: instancia,
    nino_id: nino.id,
    firmante_id: user.id,
    rol_firmante: rol,
    decision: 'firmado',
    texto_hash: sha256(TEXTO),
    texto_version: 'v1',
    nombre_tecleado: 'Firmante Pruebas',
    firma_imagen: SVG_TRAZO,
  })

  beforeAll(async () => {
    centro = await createTestCentro('Consent imagen tutor legal')
    nino = await createTestNino(centro.id, 'Nino Tutor Legal')
    admin = await createTestUser({ nombre: 'Admin Tutor Legal' })
    tutor = await createTestUser({ nombre: 'Tutor Legal Pruebas' })
    autorizado = await createTestUser({ nombre: 'Autorizado Pruebas' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', {
      puede_firmar_autorizaciones: true,
    })
    // El autorizado PUEDE firmar autorizaciones (permiso activado a propósito): así se prueba
    // que el bloqueo está en el consentimiento, no en la firma.
    await crearVinculo(nino.id, autorizado.id, 'autorizado', {
      puede_firmar_autorizaciones: true,
    })

    const { data: pl, error: errPl } = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'autorizacion_imagenes',
        es_plantilla: true,
        titulo: 'Formato imagen',
        texto: TEXTO,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    if (errPl || !pl) throw new Error(`plantilla falló: ${errPl?.message}`)
    plantilla = pl.id
    const { data: inst, error: errInst } = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'autorizacion_imagenes',
        es_plantilla: false,
        plantilla_id: plantilla,
        ambito: 'nino',
        nino_id: nino.id,
        firmantes_requeridos: 'uno_principal',
        titulo: 'Autorización de imágenes',
        texto: TEXTO,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    if (errInst || !inst) throw new Error(`instancia falló: ${errInst?.message}`)
    instancia = inst.id
  }, 240_000)

  afterAll(async () => {
    const usuarios = [admin, tutor, autorizado].filter(Boolean).map((u) => u.id)
    await serviceClient.from('consentimientos').delete().in('usuario_id', usuarios)
    await serviceClient.from('firmas_autorizacion').delete().eq('autorizacion_id', instancia)
    await serviceClient.from('autorizaciones').delete().eq('id', instancia)
    await serviceClient.from('autorizaciones').delete().eq('id', plantilla)
    await serviceClient.from('vinculos_familiares').delete().eq('nino_id', nino.id)
    await serviceClient.from('ninos').delete().eq('id', nino.id)
    for (const u of usuarios) await deleteTestUser(u)
    await deleteTestCentro(centro.id)
  }, 120_000)

  it('el vínculo autorizado no puede otorgar ni revocar por las RPCs (42501)', async () => {
    const client = await clientFor(autorizado)
    const otorgar = await client.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: nino.id,
      p_tutor: autorizado.id,
    })
    expect(otorgar.error?.code).toBe('42501')
    const revocar = await client.rpc('revocar_consentimiento_imagen', { p_nino_id: nino.id })
    expect(revocar.error?.code).toBe('42501')
    expect(await vigente(autorizado.id)).toBe(false)
  })

  it('el tutor legal sí otorga y revoca por las RPCs', async () => {
    const client = await clientFor(tutor)
    const otorgar = await client.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: nino.id,
      p_tutor: tutor.id,
    })
    expect(otorgar.error).toBeNull()
    expect(await vigente(tutor.id)).toBe(true)
    const revocar = await client.rpc('revocar_consentimiento_imagen', { p_nino_id: nino.id })
    expect(revocar.error).toBeNull()
    expect(revocar.data).toBe(1)
    expect(await vigente(tutor.id)).toBe(false)
  })

  it('el autorizado firma el documento de imagen: la firma entra, pero no genera consentimiento', async () => {
    const client = await clientFor(autorizado)
    const { error } = await client
      .from('firmas_autorizacion')
      .insert(firma(autorizado, 'autorizado'))
    // Ancla positiva: la firma SÍ se registra (el bloqueo no está en la firma)…
    expect(error).toBeNull()
    const { data: firmas } = await serviceClient
      .from('firmas_autorizacion')
      .select('id')
      .eq('autorizacion_id', instancia)
      .eq('firmante_id', autorizado.id)
    expect(firmas ?? []).toHaveLength(1)
    // …pero no crea consentimiento de imagen.
    expect(await vigente(autorizado.id)).toBe(false)
  })

  it('el tutor legal firma el documento de imagen: genera consentimiento (como siempre)', async () => {
    const client = await clientFor(tutor)
    const { error } = await client
      .from('firmas_autorizacion')
      .insert(firma(tutor, 'tutor_legal_principal'))
    expect(error).toBeNull()
    expect(await vigente(tutor.id)).toBe(true)
  })
})
