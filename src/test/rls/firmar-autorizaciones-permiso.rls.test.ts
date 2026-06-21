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
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * F8 hardening — apretar el WRITE de firmas/autorizaciones de `es_tutor_de` →
 * `tiene_permiso_sobre(nino_id,'puede_firmar_autorizaciones')` (enfoque B).
 * Migración `20260621140000_phase8_apretar_firmar_autorizaciones`.
 *
 * El gate ya no mira "existe vínculo" sino el PERMISO granular (ADR-0006). Verifica
 * los cuatro cuadrantes que distinguen B de un simple es_tutor_legal_de:
 *   1. `autorizado` SIN permiso (default) → firma e instancia B2 DENEGADAS (42501).
 *   2. `tutor_legal` con permiso → sigue firmando y creando B2 (regresión).
 *   3. `autorizado` CON permiso=true → puede (delegación de la dirección preservada).
 *   4. `tutor_legal` con permiso=false → no puede (revocación honrada).
 * Más la regresión MVCC `.insert().select()` en ambas tablas (los casos OK la cubren).
 *
 * Gateado: F8_FIRMAR_PERMISO_MIGRATION_APPLIED=1
 */
const APPLIED = process.env.F8_FIRMAR_PERMISO_MIGRATION_APPLIED === '1'

const TEXTO_REAL = 'Autorizo la recogida/medicación de mi hijo/a. Texto legal real F8.'
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const SVG_TRAZO = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/></svg>'

type AutorizacionInsert = Database['public']['Tables']['autorizaciones']['Insert']
type FirmaInsert = Database['public']['Tables']['firmas_autorizacion']['Insert']
type Ambito = Database['public']['Enums']['autorizacion_ambito']
type TipoVinculo = Database['public']['Enums']['tipo_vinculo']

const RLS_DENIED = '42501'

describe.skipIf(!APPLIED)(
  'RLS F8 — firmar/instanciar gateado por puede_firmar_autorizaciones',
  () => {
    let centro: { id: string }
    let admin: TestUser
    let tutorLegal: TestUser // tutor_legal_principal, permiso=true
    let tutorRevocado: TestUser // tutor_legal_secundario, permiso=false (revocación)
    let autorizadoSin: TestUser // autorizado, sin la clave (default-false)
    let autorizadoCon: TestUser // autorizado, permiso=true (delegación)
    let nino: { id: string }
    let plantillaRecogida: string

    const autorizacionesCreadas: string[] = []
    const firmasCreadas: string[] = []

    beforeAll(async () => {
      centro = await createTestCentro('Centro F8 permiso')
      const curso = await createTestCurso(centro.id)
      const aula = await createTestAula(centro.id, curso.id, 'Aula F8 permiso')
      nino = await createTestNino(centro.id, 'F8 Nino')
      await matricular(nino.id, aula.id, curso.id)

      admin = await createTestUser({ nombre: 'Admin F8' })
      tutorLegal = await createTestUser({ nombre: 'Tutor legal F8' })
      tutorRevocado = await createTestUser({ nombre: 'Tutor revocado F8' })
      autorizadoSin = await createTestUser({ nombre: 'Autorizado sin F8' })
      autorizadoCon = await createTestUser({ nombre: 'Autorizado con F8' })

      await asignarRol(admin.id, centro.id, 'admin')
      for (const u of [tutorLegal, tutorRevocado, autorizadoSin, autorizadoCon])
        await asignarRol(u.id, centro.id, 'tutor_legal')

      // Vínculos sobre el MISMO niño, con permisos explícitos (los tests no dependen
      // del backfill: cada vínculo nuevo nace con los permisos que aquí se fijan).
      await crearVinculo(nino.id, tutorLegal.id, 'tutor_legal_principal', {
        puede_firmar_autorizaciones: true,
      })
      await crearVinculo(nino.id, tutorRevocado.id, 'tutor_legal_secundario', {
        puede_firmar_autorizaciones: false,
      })
      await crearVinculo(nino.id, autorizadoSin.id, 'autorizado', {}) // sin la clave → default-false
      await crearVinculo(nino.id, autorizadoCon.id, 'autorizado', {
        puede_firmar_autorizaciones: true,
      })

      // Plantilla durable de recogida (catálogo) para las instancias B2.
      const { data: pl, error: plErr } = await serviceClient
        .from('autorizaciones')
        .insert({
          centro_id: centro.id,
          tipo: 'recogida',
          es_plantilla: true,
          titulo: 'Formato recogida F8',
          texto: TEXTO_REAL,
          texto_version: 'v1',
          texto_definitivo: true,
          estado: 'publicada',
          creado_por: admin.id,
        } satisfies AutorizacionInsert)
        .select('id')
        .single()
      if (plErr || !pl) throw new Error(`crear plantilla falló: ${plErr?.message}`)
      plantillaRecogida = pl.id
      autorizacionesCreadas.push(pl.id)
    })

    afterAll(async () => {
      for (const id of firmasCreadas)
        await serviceClient.from('firmas_autorizacion').delete().eq('id', id)
      // Instancias antes que su plantilla (plantilla_id es ON DELETE RESTRICT).
      for (const id of autorizacionesCreadas.slice().reverse())
        await serviceClient.from('autorizaciones').delete().eq('id', id)
      await deleteTestCentro(centro.id)
      for (const u of [admin, tutorLegal, tutorRevocado, autorizadoSin, autorizadoCon])
        await deleteTestUser(u.id)
    })

    // --- helpers (service role, bypass RLS) -----------------------------------

    /** Instancia B2 firmable (publicada + definitiva + vigencia abierta) para `nino`. */
    async function crearInstanciaFirmable(): Promise<string> {
      const { data, error } = await serviceClient
        .from('autorizaciones')
        .insert({
          centro_id: centro.id,
          tipo: 'recogida',
          es_plantilla: false,
          plantilla_id: plantillaRecogida,
          ambito: 'nino' as Ambito,
          nino_id: nino.id,
          titulo: 'Instancia recogida F8',
          texto: TEXTO_REAL,
          texto_version: 'v1',
          texto_definitivo: true,
          estado: 'publicada',
          creado_por: admin.id,
        } satisfies AutorizacionInsert)
        .select('id')
        .single()
      if (error || !data) throw new Error(`crearInstanciaFirmable falló: ${error?.message}`)
      autorizacionesCreadas.push(data.id)
      return data.id
    }

    /** Intenta firmar `autorizacionId` como `user`. Devuelve {id?, error} (RLS lo decide). */
    async function firmarComo(
      user: TestUser,
      autorizacionId: string,
      rol: TipoVinculo
    ): Promise<{ id?: string; error: unknown }> {
      const c = await clientFor(user)
      const payload: FirmaInsert = {
        autorizacion_id: autorizacionId,
        nino_id: nino.id,
        firmante_id: user.id,
        rol_firmante: rol,
        decision: 'firmado',
        texto_hash: sha256(TEXTO_REAL),
        texto_version: 'v1',
        nombre_tecleado: 'Firmante F8',
        firma_imagen: SVG_TRAZO,
      }
      const { data, error } = await c
        .from('firmas_autorizacion')
        .insert(payload)
        .select('id') // MVCC: .insert().select() con helpers STABLE
        .maybeSingle()
      if (data?.id) firmasCreadas.push(data.id)
      return { id: data?.id, error }
    }

    /** Intenta crear una instancia B2 de recogida como `user` (sujeto a RLS). */
    async function crearB2Como(user: TestUser): Promise<{ id?: string; error: unknown }> {
      const c = await clientFor(user)
      const { data, error } = await c
        .from('autorizaciones')
        .insert({
          centro_id: centro.id,
          tipo: 'recogida',
          es_plantilla: false,
          plantilla_id: plantillaRecogida,
          ambito: 'nino' as Ambito,
          nino_id: nino.id,
          titulo: 'B2 por tutor F8',
          texto: TEXTO_REAL,
          texto_version: 'v1',
          texto_definitivo: true,
          estado: 'publicada',
          creado_por: user.id,
        } satisfies AutorizacionInsert)
        .select('id') // MVCC: .insert().select()
        .maybeSingle()
      if (data?.id) autorizacionesCreadas.push(data.id)
      return { id: data?.id, error }
    }

    // === firmas_autorizacion: gate por permiso ================================

    it('autorizado SIN permiso (default-false) NO puede firmar (42501)', async () => {
      const aut = await crearInstanciaFirmable()
      const r = await firmarComo(autorizadoSin, aut, 'autorizado')
      expect(r.id, 'la firma del autorizado sin permiso debe denegarse').toBeFalsy()
      expect((r.error as { code?: string } | null)?.code).toBe(RLS_DENIED)
    })

    it('tutor_legal con permiso SIGUE firmando (regresión + MVCC .insert().select())', async () => {
      const aut = await crearInstanciaFirmable()
      const r = await firmarComo(tutorLegal, aut, 'tutor_legal_principal')
      expect(r.error, 'el tutor legal debe poder firmar').toBeNull()
      expect(r.id).toBeTruthy()
    })

    it('autorizado CON permiso=true puede firmar (delegación de la dirección preservada)', async () => {
      const aut = await crearInstanciaFirmable()
      const r = await firmarComo(autorizadoCon, aut, 'autorizado')
      expect(r.error, 'el autorizado con permiso explícito debe poder firmar').toBeNull()
      expect(r.id).toBeTruthy()
    })

    it('tutor_legal con permiso=false NO puede firmar (revocación honrada, 42501)', async () => {
      const aut = await crearInstanciaFirmable()
      const r = await firmarComo(tutorRevocado, aut, 'tutor_legal_secundario')
      expect(r.id, 'un tutor legal con el permiso revocado no debe firmar').toBeFalsy()
      expect((r.error as { code?: string } | null)?.code).toBe(RLS_DENIED)
    })

    // === autorizaciones: rama tutor B2 (instanciar) ===========================

    it('autorizado SIN permiso NO puede crear instancia B2 (42501)', async () => {
      const r = await crearB2Como(autorizadoSin)
      expect(r.id, 'el autorizado sin permiso no debe instanciar B2').toBeFalsy()
      expect((r.error as { code?: string } | null)?.code).toBe(RLS_DENIED)
    })

    it('tutor_legal con permiso SIGUE creando instancia B2 (regresión + MVCC)', async () => {
      const r = await crearB2Como(tutorLegal)
      expect(r.error, 'el tutor legal debe poder crear su instancia B2').toBeNull()
      expect(r.id).toBeTruthy()
    })

    it('autorizado CON permiso=true puede crear instancia B2 (delegación preservada)', async () => {
      const r = await crearB2Como(autorizadoCon)
      expect(r.error, 'el autorizado con permiso debe poder instanciar B2').toBeNull()
      expect(r.id).toBeTruthy()
    })
  }
)
