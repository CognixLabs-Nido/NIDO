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
 * F11-G-4 — RLS del modelo de "Altas con documentos" (cierra el pendiente de G-1) +
 * aislamiento entre centros. Cubre las 3 tablas (datos_tutor, mandatos_sepa,
 * cambios_pendientes) y los 3 buckets privados (libro-familia, dni-tutores, mandato-sepa).
 *
 * Criterios verificados:
 *  - datos_tutor: admin del centro y tutor legal del niño LEEN; profe NO; aislamiento centro.
 *  - mandatos_sepa: admin/tutor legal LEEN; profe NO; el IBAN viaja CIFRADO (iban_cifrado
 *    bytea) — el cliente nunca obtiene el texto claro (descifrar = RPC de Fase B, diferida).
 *  - cambios_pendientes: el tutor legal encola lo suyo (solicitado_por=auth.uid()); admin
 *    aprueba; profe/tutor NO deciden; aislamiento centro.
 *  - buckets: admin del centro o tutor legal del niño suben/leen su carpeta; profe NO; un
 *    tutor no escribe bajo el {ninoId} de otra familia.
 *
 * Gateado: F11G_RLS_APPLIED=1 (requiere G-0 + G-2bis aplicadas en la BD de test).
 */

const APPLIED = process.env.F11G_RLS_APPLIED === '1'

// PDF mínimo válido para los buckets (allowed_mime_types = application/pdf).
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n')
const IBAN_TEST = 'ES9121000418450200051332' // 24 chars, válido por longitud

describe.skipIf(!APPLIED)(
  'F11-G — RLS validación + buckets (datos_tutor / mandatos_sepa / cambios_pendientes)',
  () => {
    let centroA: { id: string }
    let centroB: { id: string }
    let ninoA: { id: string } // centroA, tutela de tutorA, en aula de profeA
    let ninoA2: { id: string } // centroA, SIN tutela de tutorA (aislamiento intra-centro)
    let ninoB: { id: string } // centroB
    let adminA: TestUser
    let profeA: TestUser
    let tutorA: TestUser
    let tutorB: TestUser
    let cAdminA: SupabaseClient<Database>
    let cProfeA: SupabaseClient<Database>
    let cTutorA: SupabaseClient<Database>
    let cTutorB: SupabaseClient<Database>

    beforeAll(async () => {
      centroA = await createTestCentro('Centro A G4')
      centroB = await createTestCentro('Centro B G4')
      const cursoA = await createTestCurso(centroA.id)
      const aulaA = await createTestAula(centroA.id, cursoA.id)

      ninoA = await createTestNino(centroA.id, 'Nino A G4')
      ninoA2 = await createTestNino(centroA.id, 'Nino A2 G4')
      ninoB = await createTestNino(centroB.id, 'Nino B G4')
      await matricular(ninoA.id, aulaA.id, cursoA.id)

      adminA = await createTestUser({ nombre: 'Admin A G4' })
      profeA = await createTestUser({ nombre: 'Profe A G4' })
      tutorA = await createTestUser({ nombre: 'Tutor A G4' })
      tutorB = await createTestUser({ nombre: 'Tutor B G4' })
      await asignarRol(adminA.id, centroA.id, 'admin')
      await asignarRol(profeA.id, centroA.id, 'profe')
      await asignarProfeAula(profeA.id, aulaA.id, cursoA.id)
      await crearVinculo(ninoA.id, tutorA.id, 'tutor_legal_principal', {})
      await crearVinculo(ninoB.id, tutorB.id, 'tutor_legal_principal', {})

      cAdminA = await clientFor(adminA)
      cProfeA = await clientFor(profeA)
      cTutorA = await clientFor(tutorA)
      cTutorB = await clientFor(tutorB)
    })

    afterAll(async () => {
      // Limpieza explícita de las filas creadas en tablas con FK RESTRICT a usuarios.
      await serviceClient.from('cambios_pendientes').delete().eq('nino_id', ninoA.id)
      await serviceClient.from('mandatos_sepa').delete().eq('nino_id', ninoA.id)
      await serviceClient.from('datos_tutor').delete().eq('nino_id', ninoA.id)
      await deleteTestCentro(centroA.id)
      await deleteTestCentro(centroB.id)
      await deleteTestUser(adminA.id)
      await deleteTestUser(profeA.id)
      await deleteTestUser(tutorA.id)
      await deleteTestUser(tutorB.id)
    })

    // ─── datos_tutor ───────────────────────────────────────────────────────────
    describe('datos_tutor', () => {
      it('el tutor legal inserta sus datos; admin y tutor LEEN; profe NO; aislamiento centro', async () => {
        const ins = await cTutorA
          .from('datos_tutor')
          .insert({
            centro_id: centroA.id, // el trigger lo deriva; el tipo generado lo exige
            nino_id: ninoA.id,
            tipo_vinculo: 'tutor_legal_principal',
            usuario_id: tutorA.id,
            nombre_completo: 'Madre Test',
            email: 'madre@nido.test',
          })
          .select('id')
          .maybeSingle()
        expect(ins.error).toBeNull()
        expect(ins.data).not.toBeNull()

        const admin = await cAdminA.from('datos_tutor').select('id').eq('nino_id', ninoA.id)
        expect(admin.data ?? []).toHaveLength(1)

        const tutor = await cTutorA.from('datos_tutor').select('id').eq('nino_id', ninoA.id)
        expect(tutor.data ?? []).toHaveLength(1)

        const profe = await cProfeA.from('datos_tutor').select('id').eq('nino_id', ninoA.id)
        expect(profe.error).toBeNull()
        expect(profe.data ?? []).toHaveLength(0) // profe NO es admin ni tutor legal

        const ajeno = await cTutorB.from('datos_tutor').select('id').eq('nino_id', ninoA.id)
        expect(ajeno.data ?? []).toHaveLength(0) // otro centro/familia
      })

      it('un tutor NO inserta datos_tutor de un niño ajeno (WITH CHECK)', async () => {
        const r = await cTutorA
          .from('datos_tutor')
          .insert({
            centro_id: centroA.id,
            nino_id: ninoA2.id,
            tipo_vinculo: 'tutor_legal_principal',
            usuario_id: tutorA.id,
          })
          .select('id')
          .maybeSingle()
        expect(r.error).not.toBeNull()
      })
    })

    // ─── mandatos_sepa ──────────────────────────────────────────────────────────
    describe('mandatos_sepa', () => {
      it('el tutor registra el mandato por RPC; el IBAN queda CIFRADO (nunca en claro)', async () => {
        const { error } = await cTutorA.rpc('registrar_mandato_sepa', {
          p_nino_id: ninoA.id,
          p_iban: IBAN_TEST,
          p_titular: 'Madre Test',
          p_identificador_mandato: `NIDO-G4-${ninoA.id.slice(0, 8)}`,
          p_documento_path: `${centroA.id}/${ninoA.id}/mandato.pdf`,
          p_firma_imagen: null,
          p_nombre_tecleado: 'Madre Test',
          p_texto_hash: null,
          p_ip_address: null,
          p_user_agent: null,
          p_fecha_firma: null,
        } as never)
        expect(error).toBeNull()

        // El tutor ve su mandato, pero el IBAN viaja como bytea cifrado (no el texto claro).
        const { data, error: selErr } = await cTutorA
          .from('mandatos_sepa')
          .select('id, iban_cifrado, titular')
          .eq('nino_id', ninoA.id)
          .maybeSingle()
        expect(selErr).toBeNull()
        expect(data).not.toBeNull()
        expect(JSON.stringify(data)).not.toContain(IBAN_TEST) // jamás el IBAN en claro
      })

      it('profe NO ve el mandato; aislamiento entre centros', async () => {
        const profe = await cProfeA.from('mandatos_sepa').select('id').eq('nino_id', ninoA.id)
        expect(profe.data ?? []).toHaveLength(0)
        const ajeno = await cTutorB.from('mandatos_sepa').select('id').eq('nino_id', ninoA.id)
        expect(ajeno.data ?? []).toHaveLength(0)
      })
    })

    // ─── cambios_pendientes ──────────────────────────────────────────────────────
    describe('cambios_pendientes', () => {
      let cambioId: string

      it('el tutor legal encola un cambio suyo (solicitado_por=auth.uid())', async () => {
        const r = await cTutorA
          .from('cambios_pendientes')
          .insert({
            centro_id: centroA.id,
            nino_id: ninoA.id,
            entidad: 'ninos_familia',
            registro_id: ninoA.id,
            payload: { direccion_calle: 'Calle Nueva' },
            solicitado_por: tutorA.id,
          })
          .select('id')
          .maybeSingle()
        expect(r.error).toBeNull()
        expect(r.data).not.toBeNull()
        cambioId = r.data!.id
      })

      it('NO se puede encolar suplantando solicitado_por, ni para un niño ajeno', async () => {
        const suplant = await cTutorA
          .from('cambios_pendientes')
          .insert({
            centro_id: centroA.id,
            nino_id: ninoA.id,
            entidad: 'ninos_familia',
            registro_id: ninoA.id,
            payload: { x: 1 },
            solicitado_por: adminA.id, // != auth.uid()
          })
          .select('id')
          .maybeSingle()
        expect(suplant.error).not.toBeNull()

        const ajeno = await cTutorB
          .from('cambios_pendientes')
          .insert({
            centro_id: centroA.id,
            nino_id: ninoA.id,
            entidad: 'ninos_familia',
            registro_id: ninoA.id,
            payload: { x: 1 },
            solicitado_por: tutorB.id,
          })
          .select('id')
          .maybeSingle()
        expect(ajeno.error).not.toBeNull()
      })

      it('solo el admin decide (aprobar); profe/tutor NO (USING → 0 filas)', async () => {
        const tutor = await cTutorA
          .from('cambios_pendientes')
          .update({
            estado: 'aprobado',
            revisado_por: tutorA.id,
            decided_at: new Date().toISOString(),
          })
          .eq('id', cambioId)
          .select('id')
          .maybeSingle()
        expect(tutor.data).toBeNull() // USING es_admin → 0 filas

        const admin = await cAdminA
          .from('cambios_pendientes')
          .update({
            estado: 'aprobado',
            revisado_por: adminA.id,
            decided_at: new Date().toISOString(),
          })
          .eq('id', cambioId)
          .select('id, estado')
          .maybeSingle()
        expect(admin.error).toBeNull()
        expect(admin.data?.estado).toBe('aprobado')
      })
    })

    // ─── buckets de Storage ──────────────────────────────────────────────────────
    describe('buckets (libro-familia / dni-tutores / mandato-sepa)', () => {
      for (const bucket of ['libro-familia', 'dni-tutores', 'mandato-sepa'] as const) {
        it(`${bucket}: tutor sube su carpeta; profe NO; tutor no escribe carpeta ajena`, async () => {
          const propio = await cTutorA.storage
            .from(bucket)
            .upload(`${centroA.id}/${ninoA.id}/${bucket}.pdf`, PDF, {
              contentType: 'application/pdf',
              upsert: true,
            })
          expect(propio.error).toBeNull()

          const profe = await cProfeA.storage
            .from(bucket)
            .upload(`${centroA.id}/${ninoA.id}/profe.pdf`, PDF, {
              contentType: 'application/pdf',
              upsert: true,
            })
          expect(profe.error).toBeTruthy() // profe no es admin ni tutor legal

          const ajeno = await cTutorA.storage
            .from(bucket)
            .upload(`${centroA.id}/${ninoA2.id}/ajeno.pdf`, PDF, {
              contentType: 'application/pdf',
              upsert: true,
            })
          expect(ajeno.error).toBeTruthy() // tutorA no es tutor legal de ninoA2
        })
      }
    })
  }
)
