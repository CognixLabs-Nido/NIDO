import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * F-4-0 — Reconciliación de conceptos_cobro a un MODELO ÚNICO de valor.
 *
 * Verifica el CHECK `conceptos_cobro_modelo_valor` (los inserts van por service_role,
 * que bypassa RLS pero NO los CHECK) y que el motor `cerrar_mes_cobros` sigue calculando
 * igual una cuota mensual y un servicio diario leyendo del modelo único (importe_centimos).
 *
 * Gateado: F40_MIGRATION_APPLIED=1 (requiere la migración phase_f40 aplicada en la BD de test).
 */

const APPLIED = process.env.F40_MIGRATION_APPLIED === '1'

describe.skipIf(!APPLIED)('F-4-0 — conceptos_cobro modelo único (CHECK + motor de cierre)', () => {
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

  describe('motor cerrar_mes_cobros bajo el esquema nuevo (mensual + diario)', () => {
    let centroM: { id: string }
    let nino: { id: string }
    let admin: TestUser
    let cAdmin: Awaited<ReturnType<typeof clientFor>>

    beforeAll(async () => {
      centroM = await createTestCentro('Centro F40 motor')
      const curso = await createTestCurso(centroM.id)
      const aula = await createTestAula(centroM.id, curso.id)
      nino = await createTestNino(centroM.id, 'Nino F40')
      await matricular(nino.id, aula.id, curso.id)

      admin = await createTestUser({ nombre: 'Admin F40' })
      await asignarRol(admin.id, centroM.id, 'admin')
      cAdmin = await clientFor(admin)

      // Concepto mensual (290€) y concepto diario comedor (6€/día).
      const mensual = await serviceClient
        .from('conceptos_cobro')
        .insert({
          centro_id: centroM.id,
          nombre: 'Cuota mensual',
          tipo_concepto: 'mensual',
          tipo_valor: 'fijo',
          importe_centimos: 29000,
        })
        .select('id')
        .single()
      const diario = await serviceClient
        .from('conceptos_cobro')
        .insert({
          centro_id: centroM.id,
          nombre: 'Comedor',
          tipo_concepto: 'diario',
          tipo_valor: 'fijo',
          importe_centimos: 600,
          servicio: 'comedor',
        })
        .select('id')
        .single()

      // Asignaciones del mes (sept 2026) + 3 días de comedor presentes.
      await serviceClient.from('asignacion_cuota').insert([
        {
          centro_id: centroM.id,
          nino_id: nino.id,
          concepto_id: mensual.data!.id,
          anio: 2026,
          mes: 9,
          modalidad: 'mensual',
        },
        {
          centro_id: centroM.id,
          nino_id: nino.id,
          concepto_id: diario.data!.id,
          anio: 2026,
          mes: 9,
          modalidad: 'diario',
        },
      ])
      await serviceClient.from('parte_servicio_diario').insert(
        ['2026-09-02', '2026-09-03', '2026-09-04'].map((fecha) => ({
          centro_id: centroM.id,
          nino_id: nino.id,
          fecha,
          servicio: 'comedor' as const,
          presente: true,
        }))
      )
    })

    afterAll(async () => {
      await serviceClient.from('lineas_recibo').delete().eq('centro_id', centroM.id)
      await serviceClient.from('recibos').delete().eq('centro_id', centroM.id)
      await serviceClient.from('asignacion_cuota').delete().eq('centro_id', centroM.id)
      await serviceClient.from('parte_servicio_diario').delete().eq('centro_id', centroM.id)
      await serviceClient.from('cierre_mensual').delete().eq('centro_id', centroM.id)
      await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centroM.id)
      await deleteTestCentro(centroM.id)
      await deleteTestUser(admin.id)
    })

    it('cierra el mes y emite líneas: mensual = importe una vez; diario = importe × días', async () => {
      const cierre = await cAdmin.rpc('cerrar_mes_cobros', {
        p_centro_id: centroM.id,
        p_anio: 2026,
        p_mes: 9,
      })
      expect(cierre.error).toBeNull()

      const recibo = await serviceClient
        .from('recibos')
        .select('id, total_centimos')
        .eq('nino_id', nino.id)
        .eq('anio', 2026)
        .eq('mes', 9)
        .eq('es_esporadico', false)
        .maybeSingle()
      expect(recibo.data).not.toBeNull()

      const lineas = await serviceClient
        .from('lineas_recibo')
        .select('descripcion, cantidad, precio_unitario_centimos, importe_centimos')
        .eq('recibo_id', recibo.data!.id)
      const items = lineas.data ?? []

      const mensual = items.find((l) => l.descripcion === 'Cuota mensual')
      expect(mensual?.importe_centimos).toBe(29000)
      expect(mensual?.cantidad).toBe(1)

      const diario = items.find((l) => l.descripcion?.startsWith('Comedor'))
      expect(diario?.cantidad).toBe(3)
      expect(diario?.precio_unitario_centimos).toBe(600)
      expect(diario?.importe_centimos).toBe(1800)

      // Total = 290€ + 3×6€ = 308€.
      expect(recibo.data!.total_centimos).toBe(30800)
    })
  })
})
