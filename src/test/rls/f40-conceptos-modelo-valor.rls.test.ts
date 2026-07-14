import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestCentro, deleteTestCentro, serviceClient } from './setup'

/**
 * F-4-0 — Reconciliación de conceptos_cobro a un MODELO ÚNICO de valor.
 *
 * Verifica el CHECK `conceptos_cobro_modelo_valor` (los inserts van por service_role,
 * que bypassa RLS pero NO los CHECK). El test de integración del motor `cerrar_mes_cobros`
 * se retiró en F-4-2 (la tabla asignacion_cuota que alimentaba el motor grano-niño se
 * dropeó); el motor se reescribe y re-testea a grano familia en F-4-3.
 *
 * Gateado: F40_MIGRATION_APPLIED=1 (requiere la migración phase_f40 aplicada en la BD de test).
 */

const APPLIED = process.env.F40_MIGRATION_APPLIED === '1'

describe.skipIf(!APPLIED)('F-4-0 — conceptos_cobro modelo único (CHECK de valor)', () => {
  let centro: { id: string }
  let baseConceptoId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro F40')
    // Concepto base (cobro fijo mensual) al que apuntará el descuento porcentual.
    const base = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        nombre: 'Cuota base',
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        importe_centimos: 29000,
      })
      .select('id')
      .single()
    if (base.error || !base.data) throw new Error(`base concepto: ${base.error?.message}`)
    baseConceptoId = base.data.id
  })

  afterAll(async () => {
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
  })

  describe('CHECK conceptos_cobro_modelo_valor', () => {
    it('un descuento PORCENTUAL PURO con concepto base AHORA es insertable (antes violaba precio_por_tipo)', async () => {
      const r = await serviceClient
        .from('conceptos_cobro')
        .insert({
          centro_id: centro.id,
          nombre: 'Descuento hermano -10%',
          tipo_concepto: 'mensual',
          signo: -1,
          tipo_valor: 'porcentaje',
          porcentaje_bp: 1000,
          concepto_base_id: baseConceptoId,
        })
        .select('id')
        .maybeSingle()
      expect(r.error).toBeNull()
      expect(r.data).not.toBeNull()
      if (r.data) await serviceClient.from('conceptos_cobro').delete().eq('id', r.data.id)
    })

    it('un concepto fijo SIN importe es rechazado', async () => {
      const r = await serviceClient
        .from('conceptos_cobro')
        .insert({
          centro_id: centro.id,
          nombre: 'Fijo sin importe',
          tipo_concepto: 'mensual',
          tipo_valor: 'fijo',
          importe_centimos: null,
        })
        .select('id')
        .maybeSingle()
      expect(r.error).not.toBeNull()
    })

    it('un descuento porcentual SIN concepto base es rechazado', async () => {
      const r = await serviceClient
        .from('conceptos_cobro')
        .insert({
          centro_id: centro.id,
          nombre: 'Descuento sin base',
          tipo_concepto: 'mensual',
          signo: -1,
          tipo_valor: 'porcentaje',
          porcentaje_bp: 1000,
          concepto_base_id: null,
        })
        .select('id')
        .maybeSingle()
      expect(r.error).not.toBeNull()
    })

    it('un COBRO con concepto base es rechazado', async () => {
      const r = await serviceClient
        .from('conceptos_cobro')
        .insert({
          centro_id: centro.id,
          nombre: 'Cobro con base',
          tipo_concepto: 'mensual',
          signo: 1,
          tipo_valor: 'fijo',
          importe_centimos: 5000,
          concepto_base_id: baseConceptoId,
        })
        .select('id')
        .maybeSingle()
      expect(r.error).not.toBeNull()
    })

    it('un concepto diario exige servicio', async () => {
      const r = await serviceClient
        .from('conceptos_cobro')
        .insert({
          centro_id: centro.id,
          nombre: 'Diario sin servicio',
          tipo_concepto: 'diario',
          tipo_valor: 'fijo',
          importe_centimos: 600,
          servicio: null,
        })
        .select('id')
        .maybeSingle()
      expect(r.error).not.toBeNull()
    })
  })
})
