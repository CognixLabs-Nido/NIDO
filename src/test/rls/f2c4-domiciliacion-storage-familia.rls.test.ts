import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestFamilia,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F-2c-4 — el TUTOR gestiona la domiciliación SEPA de su familia desde `/family/recibos` con
 * firma DIGITAL. Verifica dos capas:
 *
 *  A) RLS de **Storage** del path FAMILIA-scoped (migración
 *     `20260727120000_phase_f2c4_mandato_storage_familia`): el tutor sube/lee bajo
 *     `{centro}/familia/{suFamilia}/…`, NO bajo la de otra familia; y las políticas nino-scoped
 *     de F11-G-0 (`{centro}/{ninoSuyo}/mandato.pdf`) siguen funcionando (no regresión: se AÑADEN
 *     políticas, no se reemplazan).
 *
 *  B) Las RPCs por familia con params DIGITALES tal como las llama el route del tutor:
 *     `registrar` (familia sin mandato) → activo, metodo='digital', documento_path del path
 *     familia; `sustituir` → el viejo queda 'revocado' (conservado) y el nuevo 'activo' digital.
 *
 * **Gated** por `F2C4_MIGRATION_APPLIED=1` (la migración de storage se aplica a mano por SQL
 * Editor — CLI SIGILL). Comando:
 *   F2C4_MIGRATION_APPLIED=1 npm run test:rls -- f2c4-domiciliacion-storage-familia.rls
 */
const APPLIED = process.env.F2C4_MIGRATION_APPLIED === '1'

// Bytes mínimos (el bucket valida el contentType declarado, no el binario).
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
const IBAN_1 = 'ES7620770024003102575766'
const IBAN_2 = 'ES9121000418450200051332'

function argsDigital(familiaId: string, iban: string, id: string, documentoPath: string) {
  return {
    p_familia_id: familiaId,
    p_nino_id: null,
    p_iban: iban,
    p_titular: 'Ana Pérez',
    p_identificador_mandato: id,
    p_documento_path: documentoPath,
    p_firma_imagen: 'data:image/png;base64,iVBORw0KGgo=',
    p_nombre_tecleado: 'Ana Pérez',
    p_texto_hash: 'a'.repeat(64),
    p_ip_address: null,
    p_user_agent: 'test',
    p_fecha_firma: '2026-03-01T10:00:00Z',
    p_metodo: 'digital',
  } as never
}

describe.skipIf(!APPLIED)(
  'F-2c-4 — domiciliación del tutor (storage familia + RPC digital)',
  () => {
    let centro: { id: string }
    let familiaA: string
    let familiaB: string
    let tutorA: TestUser
    let tutorB: TestUser
    let ninoA: { id: string }
    let cTutorA: SupabaseClient<Database>

    const creados: { bucket: string; path: string }[] = []

    beforeAll(async () => {
      centro = await createTestCentro('Centro F2C4')
      familiaA = await createTestFamilia(centro.id)
      familiaB = await createTestFamilia(centro.id)

      tutorA = await createTestUser({ nombre: 'Tutor A F2C4' })
      tutorB = await createTestUser({ nombre: 'Tutor B F2C4' })
      await asignarRol(tutorA.id, centro.id, 'tutor_legal')
      await asignarRol(tutorB.id, centro.id, 'tutor_legal')
      await crearFamiliaTutor(familiaA, tutorA.id, 'titular')
      await crearFamiliaTutor(familiaB, tutorB.id, 'titular')

      // Niño con vínculo a tutorA → para la NO-regresión del path nino-scoped (es_tutor_legal_de).
      ninoA = await createTestNino(centro.id)
      await crearVinculo(ninoA.id, tutorA.id, 'tutor_legal_principal')

      cTutorA = await clientFor(tutorA)
    }, 60_000)

    afterAll(async () => {
      for (const o of creados) await serviceClient.storage.from(o.bucket).remove([o.path])
      await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centro.id)
      await deleteTestUser(tutorA.id)
      await deleteTestUser(tutorB.id)
      await deleteTestCentro(centro.id)
    }, 60_000)

    async function subir(user: TestUser, path: string) {
      const client = await clientFor(user)
      const res = await client.storage
        .from('mandato-sepa')
        .upload(path, PDF, { contentType: 'application/pdf', upsert: true })
      if (!res.error) creados.push({ bucket: 'mandato-sepa', path })
      return res
    }

    // ─── A) Storage familia-scoped ───────────────────────────────────────────────
    it('el tutor sube el PDF bajo {centro}/familia/{SU familia}/…', async () => {
      const res = await subir(tutorA, `${centro.id}/familia/${familiaA}/mandato-${Date.now()}.pdf`)
      expect(res.error).toBeNull()
    })

    it('el tutor NO puede subir bajo la ruta de OTRA familia', async () => {
      const res = await subir(tutorB, `${centro.id}/familia/${familiaA}/mandato-${Date.now()}.pdf`)
      expect(res.error).not.toBeNull()
    })

    it('el tutor puede firmar (leer) lo suyo y NO lo de otra familia', async () => {
      const propio = `${centro.id}/familia/${familiaA}/mandato-${Date.now()}.pdf`
      await subir(tutorA, propio)

      const okPropio = await cTutorA.storage.from('mandato-sepa').createSignedUrl(propio, 60)
      expect(okPropio.error).toBeNull()
      expect(okPropio.data?.signedUrl).toBeTruthy()

      const cB = await clientFor(tutorB)
      const ajeno = await cB.storage.from('mandato-sepa').createSignedUrl(propio, 60)
      expect(ajeno.data?.signedUrl).toBeFalsy()
    })

    it('NO regresión: el alta sigue subiendo nino-scoped {centro}/{ninoSuyo}/mandato.pdf', async () => {
      const res = await subir(tutorA, `${centro.id}/${ninoA.id}/mandato.pdf`)
      expect(res.error).toBeNull()
    })

    // ─── B) RPC digital (registrar → sustituir) ──────────────────────────────────
    it('registrar digital: 1 activo, metodo=digital, documento_path del path familia', async () => {
      const path = `${centro.id}/familia/${familiaA}/mandato-reg.pdf`
      const { error } = await cTutorA.rpc(
        'registrar_mandato_sepa',
        argsDigital(familiaA, IBAN_1, 'NIDO-F2C4-REG', path)
      )
      expect(error).toBeNull()

      const { data } = await serviceClient
        .from('mandatos_sepa')
        .select('metodo_firma, documento_path, iban_ultimos4, estado')
        .eq('familia_id', familiaA)
        .eq('estado', 'activo')
        .is('deleted_at', null)
        .maybeSingle()
      expect(data?.metodo_firma).toBe('digital')
      expect(data?.documento_path).toBe(path)
      expect(data?.iban_ultimos4).toBe('5766')
    })

    it('sustituir digital: viejo revocado (conservado), nuevo activo digital', async () => {
      const path = `${centro.id}/familia/${familiaA}/mandato-sust.pdf`
      const { error } = await cTutorA.rpc(
        'sustituir_mandato_sepa',
        argsDigital(familiaA, IBAN_2, 'NIDO-F2C4-SUST', path)
      )
      expect(error).toBeNull()

      const { data: activos } = await serviceClient
        .from('mandatos_sepa')
        .select('iban_ultimos4, metodo_firma')
        .eq('familia_id', familiaA)
        .eq('estado', 'activo')
        .is('deleted_at', null)
      expect(activos).toHaveLength(1)
      expect(activos![0].iban_ultimos4).toBe('1332')
      expect(activos![0].metodo_firma).toBe('digital')

      const { data: revocados } = await serviceClient
        .from('mandatos_sepa')
        .select('iban_ultimos4')
        .eq('familia_id', familiaA)
        .eq('estado', 'revocado')
        .is('deleted_at', null)
      expect((revocados ?? []).map((r) => r.iban_ultimos4)).toContain('5766')
    })
  }
)
