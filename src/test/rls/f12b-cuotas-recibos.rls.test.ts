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
 * F12-B-0 — RLS del modelo de "Cuotas, recibos y remesas SEPA" (fundación).
 *
 * Criterios verificados (decisiones A–K):
 *  - Catálogo (conceptos_cobro, tipos_beca), asignación (asignacion_cuota,
 *    metodo_pago_familia, becas), cierre (cierre_mensual) y remesas (remesas,
 *    recibos_remesa): SOLO el admin del centro escribe/lee; profe y tutor NO.
 *  - parte_servicio_diario: la profe del niño (o admin) apunta y lee; el tutor NO
 *    (control interno); aislamiento entre centros.
 *  - recibos + lineas_recibo: el admin gestiona; el TUTOR legal ve los recibos y el
 *    desglose de SU hijo (recibos pasados); profe NO; un tutor ajeno no ve nada.
 *  - cierre_mensual es INMUTABLE: sin policy de UPDATE (el admin no puede reabrir).
 *  - Anti-suplantación: cierre_mensual exige cerrado_por = auth.uid().
 *
 * Gateado: F12B_RLS_APPLIED=1 (requiere la migración phase12b_0 aplicada en la BD de test).
 */

const APPLIED = process.env.F12B_RLS_APPLIED === '1'

describe.skipIf(!APPLIED)(
  'F12-B — RLS cuotas/recibos/remesas (catálogo · asignación · parte · recibos · remesas)',
  () => {
    let centroA: { id: string }
    let centroB: { id: string }
    let ninoA: { id: string } // centroA, tutela de tutorA, en aula de profeA
    let ninoB: { id: string } // centroB
    let adminA: TestUser
    let profeA: TestUser
    let tutorA: TestUser
    let tutorB: TestUser
    let cAdminA: SupabaseClient<Database>
    let cProfeA: SupabaseClient<Database>
    let cTutorA: SupabaseClient<Database>
    let cTutorB: SupabaseClient<Database>
    let conceptoId: string
    let tipoBecaId: string
    let reciboId: string

    beforeAll(async () => {
      centroA = await createTestCentro('Centro A F12B')
      centroB = await createTestCentro('Centro B F12B')
      const cursoA = await createTestCurso(centroA.id)
      const aulaA = await createTestAula(centroA.id, cursoA.id)

      ninoA = await createTestNino(centroA.id, 'Nino A F12B')
      ninoB = await createTestNino(centroB.id, 'Nino B F12B')
      await matricular(ninoA.id, aulaA.id, cursoA.id)

      adminA = await createTestUser({ nombre: 'Admin A F12B' })
      profeA = await createTestUser({ nombre: 'Profe A F12B' })
      tutorA = await createTestUser({ nombre: 'Tutor A F12B' })
      tutorB = await createTestUser({ nombre: 'Tutor B F12B' })
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
      const centros = [centroA.id, centroB.id]
      // Orden: hijos antes que padres (FK RESTRICT a usuarios / recibos).
      await serviceClient.from('recibos_remesa').delete().in('centro_id', centros)
      await serviceClient.from('remesas').delete().in('centro_id', centros)
      await serviceClient.from('lineas_recibo').delete().in('centro_id', centros)
      await serviceClient.from('recibos').delete().in('centro_id', centros)
      await serviceClient.from('asignacion_cuota').delete().in('centro_id', centros)
      await serviceClient.from('becas').delete().in('centro_id', centros)
      await serviceClient.from('metodo_pago_familia').delete().in('centro_id', centros)
      await serviceClient.from('parte_servicio_diario').delete().in('centro_id', centros)
      await serviceClient.from('cierre_mensual').delete().in('centro_id', centros)
      await serviceClient.from('conceptos_cobro').delete().in('centro_id', centros)
      await serviceClient.from('tipos_beca').delete().in('centro_id', centros)
      await deleteTestCentro(centroA.id)
      await deleteTestCentro(centroB.id)
      await deleteTestUser(adminA.id)
      await deleteTestUser(profeA.id)
      await deleteTestUser(tutorA.id)
      await deleteTestUser(tutorB.id)
    })

    // ─── catálogo: conceptos_cobro / tipos_beca ─────────────────────────────────
    describe('catálogo (conceptos_cobro / tipos_beca)', () => {
      it('el admin crea concepto y tipo de beca; profe y tutor NO', async () => {
        const concepto = await cAdminA
          .from('conceptos_cobro')
          .insert({
            centro_id: centroA.id,
            nombre: 'Comedor',
            tipo_concepto: 'diario',
            tipo_valor: 'fijo',
            importe_centimos: 600,
            servicio: 'comedor',
          })
          .select('id')
          .maybeSingle()
        expect(concepto.error).toBeNull()
        expect(concepto.data).not.toBeNull()
        conceptoId = concepto.data!.id

        const tipoBeca = await cAdminA
          .from('tipos_beca')
          .insert({ centro_id: centroA.id, nombre: 'Beca comedor' })
          .select('id')
          .maybeSingle()
        expect(tipoBeca.error).toBeNull()
        tipoBecaId = tipoBeca.data!.id

        const profe = await cProfeA
          .from('conceptos_cobro')
          .insert({
            centro_id: centroA.id,
            nombre: 'Profe intento',
            tipo_concepto: 'mensual',
            tipo_valor: 'fijo',
            importe_centimos: 100,
          })
          .select('id')
          .maybeSingle()
        expect(profe.error).not.toBeNull()

        // El catálogo es admin-only: profe y tutor no lo leen.
        const tutorLee = await cTutorA
          .from('conceptos_cobro')
          .select('id')
          .eq('centro_id', centroA.id)
        expect(tutorLee.data ?? []).toHaveLength(0)
        const ajeno = await cTutorB.from('conceptos_cobro').select('id').eq('centro_id', centroA.id)
        expect(ajeno.data ?? []).toHaveLength(0)
      })
    })

    // ─── asignación: asignacion_cuota / metodo_pago_familia / becas ─────────────
    describe('asignación (asignacion_cuota / metodo_pago_familia / becas)', () => {
      it('el admin asigna modalidad, método y beca; profe NO', async () => {
        const asignacion = await cAdminA
          .from('asignacion_cuota')
          .insert({
            centro_id: centroA.id,
            nino_id: ninoA.id,
            concepto_id: conceptoId,
            anio: 2026,
            mes: 6,
            modalidad: 'mensual',
          })
          .select('id')
          .maybeSingle()
        expect(asignacion.error).toBeNull()

        const metodo = await cAdminA
          .from('metodo_pago_familia')
          .insert({ centro_id: centroA.id, nino_id: ninoA.id, anio: 2026, mes: 6, metodo: 'sepa' })
          .select('id')
          .maybeSingle()
        expect(metodo.error).toBeNull()

        const beca = await cAdminA
          .from('becas')
          .insert({
            centro_id: centroA.id,
            nino_id: ninoA.id,
            tipo_beca_id: tipoBecaId,
            importe_centimos: 10000,
            fecha_desde: '2026-06-01',
          })
          .select('id')
          .maybeSingle()
        expect(beca.error).toBeNull()

        const profe = await cProfeA
          .from('metodo_pago_familia')
          .insert({
            centro_id: centroA.id,
            nino_id: ninoA.id,
            anio: 2026,
            mes: 7,
            metodo: 'efectivo',
          })
          .select('id')
          .maybeSingle()
        expect(profe.error).not.toBeNull()
        const tutor = await cTutorA.from('asignacion_cuota').select('id').eq('nino_id', ninoA.id)
        expect(tutor.data ?? []).toHaveLength(0) // asignación es admin-only
      })
    })

    // ─── parte_servicio_diario ──────────────────────────────────────────────────
    describe('parte_servicio_diario', () => {
      it('la profe apunta el parte de su niño; admin lo lee; el tutor NO; aislamiento centro', async () => {
        const profe = await cProfeA
          .from('parte_servicio_diario')
          .insert({
            centro_id: centroA.id,
            nino_id: ninoA.id,
            fecha: '2026-06-15',
            servicio: 'comedor',
            presente: true,
          })
          .select('id')
          .maybeSingle()
        expect(profe.error).toBeNull()

        const admin = await cAdminA
          .from('parte_servicio_diario')
          .select('id')
          .eq('nino_id', ninoA.id)
        expect(admin.data ?? []).toHaveLength(1)

        const tutor = await cTutorA
          .from('parte_servicio_diario')
          .select('id')
          .eq('nino_id', ninoA.id)
        expect(tutor.data ?? []).toHaveLength(0) // el tutor no ve el parte (control interno)

        // La profe de centroA no apunta partes de un niño de otro centro.
        const ajeno = await cProfeA
          .from('parte_servicio_diario')
          .insert({
            centro_id: centroB.id,
            nino_id: ninoB.id,
            fecha: '2026-06-15',
            servicio: 'comedor',
          })
          .select('id')
          .maybeSingle()
        expect(ajeno.error).not.toBeNull()
      })
    })

    // ─── cierre_mensual ──────────────────────────────────────────────────────────
    describe('cierre_mensual', () => {
      let cierreId: string

      it('solo el admin cierra (cerrado_por = auth.uid()); profe NO', async () => {
        const cierre = await cAdminA
          .from('cierre_mensual')
          .insert({ centro_id: centroA.id, anio: 2026, mes: 6, cerrado_por: adminA.id })
          .select('id')
          .maybeSingle()
        expect(cierre.error).toBeNull()
        cierreId = cierre.data!.id

        const suplant = await cAdminA
          .from('cierre_mensual')
          .insert({ centro_id: centroA.id, anio: 2026, mes: 5, cerrado_por: profeA.id })
          .select('id')
          .maybeSingle()
        expect(suplant.error).not.toBeNull() // cerrado_por != auth.uid()

        const profe = await cProfeA
          .from('cierre_mensual')
          .insert({ centro_id: centroA.id, anio: 2026, mes: 4, cerrado_por: profeA.id })
          .select('id')
          .maybeSingle()
        expect(profe.error).not.toBeNull()
      })

      it('el cierre es INMUTABLE: el admin no puede reabrirlo (sin policy UPDATE → 0 filas)', async () => {
        const reabrir = await cAdminA
          .from('cierre_mensual')
          .update({ mes: 7 })
          .eq('id', cierreId)
          .select('id')
          .maybeSingle()
        expect(reabrir.data).toBeNull() // default DENY de UPDATE → no afecta filas
      })
    })

    // ─── recibos + lineas_recibo ─────────────────────────────────────────────────
    describe('recibos + lineas_recibo', () => {
      it('el admin emite recibo y líneas; el tutor ve los SUYOS; profe NO; tutor ajeno NO', async () => {
        // Mes 7 (ABIERTO): el bloque de cierre_mensual cerró 2026-06, y el trigger de
        // congelado (B-4) bloquea INSERT de un recibo regular en un mes ya cerrado.
        const recibo = await cAdminA
          .from('recibos')
          .insert({
            centro_id: centroA.id,
            nino_id: ninoA.id,
            anio: 2026,
            mes: 7,
            metodo: 'sepa',
            total_centimos: 9000,
          })
          .select('id')
          .maybeSingle()
        expect(recibo.error).toBeNull()
        reciboId = recibo.data!.id

        const linea = await cAdminA
          .from('lineas_recibo')
          .insert({
            centro_id: centroA.id,
            recibo_id: reciboId,
            concepto_id: conceptoId,
            descripcion: 'Comedor julio',
            cantidad: 1,
            precio_unitario_centimos: 9000,
            importe_centimos: 9000,
          })
          .select('id')
          .maybeSingle()
        expect(linea.error).toBeNull()

        // El tutor legal ve el recibo y su desglose.
        const tutorRecibo = await cTutorA.from('recibos').select('id').eq('nino_id', ninoA.id)
        expect(tutorRecibo.data ?? []).toHaveLength(1)
        const tutorLineas = await cTutorA
          .from('lineas_recibo')
          .select('id')
          .eq('recibo_id', reciboId)
        expect(tutorLineas.data ?? []).toHaveLength(1)

        // Profe NO ve recibos; tutor de otra familia/centro tampoco.
        const profe = await cProfeA.from('recibos').select('id').eq('nino_id', ninoA.id)
        expect(profe.data ?? []).toHaveLength(0)
        const ajeno = await cTutorB.from('recibos').select('id').eq('nino_id', ninoA.id)
        expect(ajeno.data ?? []).toHaveLength(0)

        // El tutor no emite recibos (admin-only).
        const tutorInserta = await cTutorA
          .from('recibos')
          .insert({
            centro_id: centroA.id,
            nino_id: ninoA.id,
            anio: 2026,
            mes: 7,
            metodo: 'efectivo',
          })
          .select('id')
          .maybeSingle()
        expect(tutorInserta.error).not.toBeNull()
      })
    })

    // ─── remesas + recibos_remesa ────────────────────────────────────────────────
    describe('remesas + recibos_remesa', () => {
      it('el admin crea remesa y la liga a recibos; profe y tutor NO ven nada', async () => {
        const remesa = await cAdminA
          .from('remesas')
          .insert({ centro_id: centroA.id, anio: 2026, mes: 6 })
          .select('id')
          .maybeSingle()
        expect(remesa.error).toBeNull()
        const remesaId = remesa.data!.id

        const liga = await cAdminA
          .from('recibos_remesa')
          .insert({ centro_id: centroA.id, remesa_id: remesaId, recibo_id: reciboId })
          .select('id')
          .maybeSingle()
        expect(liga.error).toBeNull()

        const profe = await cProfeA.from('remesas').select('id').eq('centro_id', centroA.id)
        expect(profe.data ?? []).toHaveLength(0)
        const tutor = await cTutorA.from('remesas').select('id').eq('centro_id', centroA.id)
        expect(tutor.data ?? []).toHaveLength(0)
      })
    })
  }
)
