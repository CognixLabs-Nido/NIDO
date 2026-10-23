import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'
import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * PR-4 (`20261109120000`) — quien tiene la cuota mensual de un servicio no paga sus días.
 *
 *  - Con el comedor mensual y el comedor diario asignados al mismo niño, el motor cobraba los dos.
 *  - Ahora un mensual puede ser «de comedor» (CHECK `conceptos_cobro_modelo_valor` relajado, solo
 *    para un cobro fijo por niño) y `generar_recibos_mes` no cobra los días de ese servicio a
 *    quien tiene el mensual asignado, vigente y activo.
 *  - Los días de otro servicio, y los de quien no tiene el mensual ese mes, se cobran igual.
 */

type Servicio = Database['public']['Enums']['servicio_diario']
type ConceptoInsert = Database['public']['Tables']['conceptos_cobro']['Insert']

const ANIO = 2026
const MES = 6
const DIAS = ['2026-06-02', '2026-06-03', '2026-06-04']

describe('PR-4 — el mensual de un servicio excluye los días', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>

  async function nino(): Promise<string> {
    const familia = await createTestFamilia(centro.id)
    const { data, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        nombre: 'Nino PR4',
        apellidos: 'Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`nino: ${error?.message}`)
    await matricular(data.id, aula.id, curso.id)
    return data.id
  }

  async function concepto(o: Partial<ConceptoInsert> & { nombre: string }): Promise<string> {
    const { data, error } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        signo: 1,
        ambito: 'nino',
        ...o,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`concepto ${o.nombre}: ${error?.message}`)
    return data.id
  }

  async function asignar(ninoId: string, conceptoId: string, vigenciaHasta?: string) {
    const { error } = await serviceClient.from('asignacion_concepto').insert({
      centro_id: centro.id,
      nino_id: ninoId,
      concepto_id: conceptoId,
      origen: 'manual',
      vigencia_hasta: vigenciaHasta ?? null,
    })
    if (error) throw new Error(`asignar: ${error.message}`)
  }

  async function parte(ninoId: string, servicio: Servicio) {
    const { error } = await serviceClient.from('parte_servicio_diario').insert(
      DIAS.map((fecha) => ({
        centro_id: centro.id,
        nino_id: ninoId,
        fecha,
        servicio,
        presente: true,
      }))
    )
    if (error) throw new Error(`parte: ${error.message}`)
  }

  async function generar() {
    const { error } = await cAdmin.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: MES,
    })
    expect(error).toBeNull()
  }

  async function lineas(ninoId: string, conceptoId: string) {
    const { data } = await serviceClient
      .from('lineas_recibo')
      .select('cantidad, importe_centimos')
      .eq('nino_id', ninoId)
      .eq('concepto_id', conceptoId)
    return data ?? []
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Mensual Excluye Dias PR4')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Mensual PR4' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('parte_servicio_diario').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  }, 60_000)

  it('premisa: sin el mensual del servicio, el diario cobra los días del parte', async () => {
    const n = await nino()
    const diario = await concepto({
      nombre: 'Comedor diario premisa',
      tipo_concepto: 'diario',
      importe_centimos: 700,
      servicio: 'comedor',
    })
    await asignar(n, diario)
    await parte(n, 'comedor')
    await generar()
    expect(await lineas(n, diario)).toEqual([{ cantidad: 3, importe_centimos: 2100 }])
  })

  it('quien tiene el mensual de comedor no paga los días de comedor', async () => {
    const n = await nino()
    const mensual = await concepto({
      nombre: 'Comedor mensual',
      importe_centimos: 15000,
      servicio: 'comedor',
    })
    const diario = await concepto({
      nombre: 'Comedor diario',
      tipo_concepto: 'diario',
      importe_centimos: 700,
      servicio: 'comedor',
    })
    await asignar(n, mensual)
    await asignar(n, diario)
    await parte(n, 'comedor')
    // Dos pasadas: regenerar no cambia nada.
    for (let i = 0; i < 2; i++) {
      await generar()
      expect(await lineas(n, mensual)).toEqual([{ cantidad: 1, importe_centimos: 15000 }])
      expect(await lineas(n, diario)).toEqual([])
    }
  })

  it('los días de otro servicio se cobran igual', async () => {
    const n = await nino()
    const mensual = await concepto({
      nombre: 'Comedor mensual (matinera aparte)',
      importe_centimos: 15000,
      servicio: 'comedor',
    })
    const matinera = await concepto({
      nombre: 'Matinera diaria',
      tipo_concepto: 'diario',
      importe_centimos: 300,
      servicio: 'matinera',
    })
    await asignar(n, mensual)
    await asignar(n, matinera)
    await parte(n, 'matinera')
    await generar()
    expect(await lineas(n, matinera)).toEqual([{ cantidad: 3, importe_centimos: 900 }])
  })

  it('con el mensual fuera de vigencia, o desactivado, se pagan los días', async () => {
    const vencido = await nino()
    const desactivado = await nino()
    const mensualVencido = await concepto({
      nombre: 'Comedor mensual vencido',
      importe_centimos: 15000,
      servicio: 'comedor',
    })
    const mensualInactivo = await concepto({
      nombre: 'Comedor mensual inactivo',
      importe_centimos: 15000,
      servicio: 'comedor',
      activo: false,
    })
    const diario = await concepto({
      nombre: 'Comedor diario (vigencia)',
      tipo_concepto: 'diario',
      importe_centimos: 700,
      servicio: 'comedor',
    })
    await asignar(vencido, mensualVencido, '2026-05-31')
    await asignar(vencido, diario)
    await asignar(desactivado, mensualInactivo)
    await asignar(desactivado, diario)
    await parte(vencido, 'comedor')
    await parte(desactivado, 'comedor')
    await generar()
    expect(await lineas(vencido, mensualVencido)).toEqual([])
    expect(await lineas(vencido, diario)).toEqual([{ cantidad: 3, importe_centimos: 2100 }])
    expect(await lineas(desactivado, mensualInactivo)).toEqual([])
    expect(await lineas(desactivado, diario)).toEqual([{ cantidad: 3, importe_centimos: 2100 }])
  })

  it('Dirección crea un mensual de comedor; el servicio solo cabe en un cobro fijo por niño', async () => {
    const base = {
      centro_id: centro.id,
      nombre: 'Mensual servicio Dirección',
      tipo_concepto: 'mensual' as const,
      tipo_valor: 'fijo',
      signo: 1,
      ambito: 'nino',
      importe_centimos: 5000,
      servicio: 'vespertina' as const,
    }
    const ok = await cAdmin.from('conceptos_cobro').insert(base).select('id').single()
    expect(ok.error).toBeNull()

    const rechazados: Array<[string, Partial<ConceptoInsert>]> = [
      ['de familia', { ambito: 'familia' }],
      ['descuento', { signo: -1 }],
      ['porcentaje', { tipo_valor: 'porcentaje', importe_centimos: null, porcentaje_bp: 1000 }],
      ['esporádico', { tipo_concepto: 'esporadico' }],
    ]
    for (const [caso, over] of rechazados) {
      const { error } = await cAdmin.from('conceptos_cobro').insert({ ...base, ...over })
      expect(error?.code, caso).toBe('23514')
    }
  })
})
