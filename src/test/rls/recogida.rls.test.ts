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
 * RLS + integridad de **recogida** (F8-2-0). **Gated** por
 * `F8_2_MIGRATION_APPLIED=1`: la migración `20260606120000_phase8_2_recogida.sql`
 * se aplica manualmente vía SQL Editor.
 *
 *   F8_2_MIGRATION_APPLIED=1 npm run test:rls -- recogida.rls
 *
 * Cubre lo nuevo de F8-2-0:
 *  - La lista (`firmas_autorizacion.datos`) viaja con la firma: `.insert().select()`
 *    (MVCC) la devuelve, y es **inmutable** (UPDATE/DELETE deny).
 *  - **Congelar el alcance**: con una firma existente, no se puede cambiar
 *    vigencia/datos/texto de la autorización (el trigger lanza), pero **sí anular**.
 *  - CHECK de tamaño de `datos`.
 */
const MIGRATION_APPLIED = process.env.F8_2_MIGRATION_APPLIED === '1'

const TEXTO = 'Autorizo a las siguientes personas a recoger a mi hijo/a.'
const PERSONAS = [{ nombre: 'Ana Pérez', dni: '12345678Z', parentesco: 'abuela' }]
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

type FirmaInsert = Database['public']['Tables']['firmas_autorizacion']['Insert']

describe.skipIf(!MIGRATION_APPLIED)(
  'RLS recogida — F8-2-0 (datos de firma + congelar alcance)',
  () => {
    let centro: { id: string }
    let admin: TestUser
    let tutor: TestUser
    let nino: { id: string }
    const autorizacionesCreadas: string[] = []
    const firmasCreadas: string[] = []

    beforeAll(async () => {
      centro = await createTestCentro('Centro Recogida')
      const curso = await createTestCurso(centro.id)
      const aula = await createTestAula(centro.id, curso.id, 'Aula Recogida')
      nino = await createTestNino(centro.id, 'Recogida Nino')
      await matricular(nino.id, aula.id, curso.id)

      admin = await createTestUser({ nombre: 'Admin Rec' })
      tutor = await createTestUser({ nombre: 'Tutor Rec' })
      await asignarRol(admin.id, centro.id, 'admin')
      await asignarRol(tutor.id, centro.id, 'tutor_legal')
      await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', {
        puede_recibir_mensajes: true,
      })
    })

    afterAll(async () => {
      for (const id of firmasCreadas)
        await serviceClient.from('firmas_autorizacion').delete().eq('id', id)
      for (const id of autorizacionesCreadas)
        await serviceClient.from('autorizaciones').delete().eq('id', id)
      await deleteTestCentro(centro.id)
      for (const u of [admin, tutor]) await deleteTestUser(u.id)
    })

    /** Crea una autorización de recogida firmable (publicada + texto definitivo). */
    async function crearRecogidaFirmable(modalidad: 'habitual' | 'puntual' = 'habitual') {
      const { data, error } = await serviceClient
        .from('autorizaciones')
        .insert({
          centro_id: centro.id,
          tipo: 'recogida',
          nino_id: nino.id,
          titulo: 'Recogida',
          texto: TEXTO,
          texto_version: 'v1',
          texto_definitivo: true,
          estado: 'publicada',
          firmantes_requeridos: 'uno_principal',
          datos: { modalidad },
          creado_por: admin.id,
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(`crearRecogidaFirmable: ${error?.message}`)
      autorizacionesCreadas.push(data.id)
      return data.id
    }

    async function firmarConLista(autId: string, personas: unknown = PERSONAS) {
      const c = await clientFor(tutor)
      const payload: FirmaInsert = {
        autorizacion_id: autId,
        nino_id: nino.id,
        firmante_id: tutor.id,
        rol_firmante: 'tutor_legal_principal',
        decision: 'firmado',
        texto_hash: sha256(TEXTO + JSON.stringify(personas)),
        texto_version: 'v1',
        nombre_tecleado: 'Tutor Rec',
        firma_imagen: 'data:image/png;base64,AAAA',
        datos: {
          personas,
        } as Database['public']['Tables']['firmas_autorizacion']['Insert']['datos'],
      }
      const { data, error } = await c
        .from('firmas_autorizacion')
        .insert(payload)
        .select('id, datos')
        .maybeSingle()
      if (data?.id) firmasCreadas.push(data.id)
      return { id: data?.id, datos: data?.datos, error }
    }

    it('la lista viaja con la firma (.insert().select() — MVCC) y round-trip de datos', async () => {
      const autId = await crearRecogidaFirmable()
      const r = await firmarConLista(autId)
      expect(r.error).toBeNull()
      expect(r.id).toBeTruthy()
      expect((r.datos as { personas: unknown[] }).personas).toHaveLength(1)
    })

    it('la firma (con datos) es inmutable: UPDATE de datos denegado (0 filas)', async () => {
      const autId = await crearRecogidaFirmable()
      const firma = await firmarConLista(autId)
      const c = await clientFor(tutor)
      const upd = await c
        .from('firmas_autorizacion')
        .update({ datos: { personas: [] } })
        .eq('id', firma.id!)
        .select('id')
        .maybeSingle()
      expect(upd.data?.id).toBeFalsy()
      // datos intactos en BD
      const { data: sigue } = await serviceClient
        .from('firmas_autorizacion')
        .select('datos')
        .eq('id', firma.id!)
        .single()
      expect((sigue!.datos as { personas: unknown[] }).personas).toHaveLength(1)
    })

    it('congela el alcance: con firma no se cambia vigencia/datos/texto, pero SÍ se anula', async () => {
      const autId = await crearRecogidaFirmable()
      await firmarConLista(autId)

      // vigencia → bloqueado por el trigger (service role bypassa RLS, no el trigger).
      const vig = await serviceClient
        .from('autorizaciones')
        .update({ vigencia_hasta: '2099-12-31' })
        .eq('id', autId)
      expect(vig.error).not.toBeNull()

      // datos (modalidad) → bloqueado.
      const dat = await serviceClient
        .from('autorizaciones')
        .update({ datos: { modalidad: 'puntual' } })
        .eq('id', autId)
      expect(dat.error).not.toBeNull()

      // texto → bloqueado.
      const txt = await serviceClient
        .from('autorizaciones')
        .update({ texto: 'otro texto', texto_version: 'v2' })
        .eq('id', autId)
      expect(txt.error).not.toBeNull()

      // estado='anulada' → permitido (no altera lo consentido).
      const anu = await serviceClient
        .from('autorizaciones')
        .update({ estado: 'anulada' })
        .eq('id', autId)
        .select('id')
        .maybeSingle()
      expect(anu.error).toBeNull()
      expect(anu.data?.id).toBe(autId)
    })

    it('el alcance SÍ se puede editar mientras no haya firmas', async () => {
      const { data: aut } = await serviceClient
        .from('autorizaciones')
        .insert({
          centro_id: centro.id,
          tipo: 'recogida',
          nino_id: nino.id,
          titulo: 'Recogida editable',
          texto: 'PENDIENTE',
          texto_version: 'v0-pendiente',
          texto_definitivo: false,
          estado: 'borrador',
          creado_por: admin.id,
        })
        .select('id')
        .single()
      autorizacionesCreadas.push(aut!.id)
      const upd = await serviceClient
        .from('autorizaciones')
        .update({ vigencia_hasta: '2099-12-31', datos: { modalidad: 'habitual' } })
        .eq('id', aut!.id)
        .select('id')
        .maybeSingle()
      expect(upd.error).toBeNull()
      expect(upd.data?.id).toBe(aut!.id)
    })

    it('el CHECK de tamaño rechaza un datos enorme', async () => {
      const autId = await crearRecogidaFirmable()
      const personasEnormes = Array.from({ length: 2000 }, (_, i) => ({
        nombre: `Persona ${i}`,
        dni: `${i}`.padStart(9, '0'),
      }))
      const r = await firmarConLista(autId, personasEnormes)
      expect(r.error).not.toBeNull()
      expect(r.id).toBeFalsy()
    })
  }
)
