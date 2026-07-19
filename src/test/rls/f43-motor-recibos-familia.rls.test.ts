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
 * F-4-3 — MOTOR de recibos a grano FAMILIA.
 *
 * Verifica generar_recibos_mes (1 recibo familiar, líneas por hijo, mensual/diario, override,
 * vigencia, becas, descuento hermanos %/fijo, descuento niño-scoped, saldo, descarte,
 * idempotencia), confirmar_recibo (por recibo + ancla de cierre), el congelado POR ESTADO
 * y crear_recibo_esporadico familiar.
 *
 * Gateado: F43_MIGRATION_APPLIED=1 (requiere phase_f43 aplicada en la BD de test).
 */

const APPLIED = process.env.F43_MIGRATION_APPLIED === '1'
// D-6-2: la beca comedor variable por mes se aplica en el motor como línea negativa. El
// bloque de abajo requiere ADEMÁS la migración D-6 (tabla beca_comedor_mes + PASE 2-bis).
const D6 = process.env.D6_BECA_COMEDOR_APPLIED === '1'

type AsignacionInsert = Database['public']['Tables']['asignacion_concepto']['Insert']
type LineaInsert = Database['public']['Tables']['lineas_recibo']['Insert']

// ── helpers de siembra (serviceClient bypassa RLS, no los CHECK) ──────────────
async function insertarNino(centroId: string, familiaId: string, nombre: string): Promise<string> {
  const { data, error } = await serviceClient
    .from('ninos')
    .insert({
      centro_id: centroId,
      familia_id: familiaId,
      nombre,
      apellidos: 'Test',
      fecha_nacimiento: '2024-03-15',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`insertarNino: ${error?.message}`)
  return data.id
}

interface MkConcepto {
  nombre: string
  tipo_concepto?: 'mensual' | 'diario' | 'esporadico'
  tipo_valor?: 'fijo' | 'porcentaje'
  signo?: number
  ambito?: 'nino' | 'familia'
  importe_centimos?: number | null
  porcentaje_bp?: number | null
  servicio?: 'comedor' | 'matinera' | 'vespertina' | null
  concepto_base_id?: string | null
}

async function mkConcepto(centroId: string, o: MkConcepto): Promise<string> {
  const { data, error } = await serviceClient
    .from('conceptos_cobro')
    .insert({
      centro_id: centroId,
      nombre: o.nombre,
      tipo_concepto: o.tipo_concepto ?? 'mensual',
      tipo_valor: o.tipo_valor ?? 'fijo',
      signo: o.signo ?? 1,
      ambito: o.ambito ?? 'nino',
      importe_centimos: o.importe_centimos ?? null,
      porcentaje_bp: o.porcentaje_bp ?? null,
      servicio: o.servicio ?? null,
      concepto_base_id: o.concepto_base_id ?? null,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`mkConcepto ${o.nombre}: ${error?.message}`)
  return data.id
}

async function asignar(row: Partial<AsignacionInsert> & { concepto_id: string }): Promise<void> {
  const { error } = await serviceClient
    .from('asignacion_concepto')
    .insert({ origen: 'manual', ...row } as AsignacionInsert)
  if (error) throw new Error(`asignar: ${error.message}`)
}

async function reciboRegular(familiaId: string, anio: number, mes: number) {
  const { data: recibo } = await serviceClient
    .from('recibos')
    .select('id, estado, total_centimos, nino_id')
    .eq('familia_id', familiaId)
    .eq('anio', anio)
    .eq('mes', mes)
    .eq('es_esporadico', false)
    .is('devuelto_de_recibo_id', null)
    .is('deleted_at', null)
    .maybeSingle()
  if (!recibo) return { recibo: null, lineas: [] as Array<Record<string, unknown>> }
  const { data: lineas } = await serviceClient
    .from('lineas_recibo')
    .select('nino_id, concepto_id, descripcion, cantidad, importe_centimos')
    .eq('recibo_id', recibo.id)
  return { recibo, lineas: lineas ?? [] }
}

describe.skipIf(!APPLIED)('F-4-3 — motor de recibos a grano FAMILIA', () => {
  // ── Bloque A: generación (sin confirmar → sin cierre) ───────────────────────
  describe('generación', () => {
    let centro: { id: string }
    let curso: { id: string }
    let aula: { id: string }
    let admin: TestUser
    let cAdmin: Awaited<ReturnType<typeof clientFor>>
    const ANIO = 2026
    const MES = 6

    beforeAll(async () => {
      centro = await createTestCentro('Centro F43 gen')
      curso = await createTestCurso(centro.id)
      aula = await createTestAula(centro.id, curso.id)
      admin = await createTestUser({ nombre: 'Admin F43 gen' })
      await asignarRol(admin.id, centro.id, 'admin')
      cAdmin = await clientFor(admin)
    })

    afterAll(async () => {
      await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
      await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
      await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
      await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
      await serviceClient.from('parte_servicio_diario').delete().eq('centro_id', centro.id)
      await serviceClient.from('becas').delete().eq('centro_id', centro.id)
      await serviceClient.from('tipos_beca').delete().eq('centro_id', centro.id)
      await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
      await deleteTestCentro(centro.id)
      await deleteTestUser(admin.id)
    })

    async function nuevaFamilia(nombres: string[]): Promise<{ familia: string; ninos: string[] }> {
      const familia = await createTestFamilia(centro.id)
      const ninos: string[] = []
      for (const nombre of nombres) {
        const id = await insertarNino(centro.id, familia, nombre)
        await matricular(id, aula.id, curso.id)
        ninos.push(id)
      }
      return { familia, ninos }
    }

    const gen = () =>
      cAdmin.rpc('generar_recibos_mes', { p_centro_id: centro.id, p_anio: ANIO, p_mes: MES })

    it('1 recibo familiar con líneas de todos los hijos (nino_id) — mensual', async () => {
      const { familia, ninos } = await nuevaFamilia(['Lucía', 'Mateo'])
      const cuota = await mkConcepto(centro.id, {
        nombre: 'Cuota ' + familia,
        importe_centimos: 20000,
      })
      await asignar({ concepto_id: cuota, nino_id: ninos[0] })
      await asignar({ concepto_id: cuota, nino_id: ninos[1] })

      const r = await gen()
      expect(r.error).toBeNull()

      const { recibo, lineas } = await reciboRegular(familia, ANIO, MES)
      expect(recibo?.estado).toBe('borrador')
      expect(recibo?.nino_id).toBeNull() // recibo familiar
      const porNino = lineas.filter((l) => l.concepto_id === cuota)
      expect(porNino.map((l) => l.nino_id).sort()).toEqual([...ninos].sort())
      expect(recibo?.total_centimos).toBe(40000)
    })

    it('diario cobra importe × días del parte (cantidad_default ignorado)', async () => {
      const { familia, ninos } = await nuevaFamilia(['Comedorito'])
      const comedor = await mkConcepto(centro.id, {
        nombre: 'Comedor ' + familia,
        tipo_concepto: 'diario',
        importe_centimos: 600,
        servicio: 'comedor',
      })
      // cantidad_default=5 debe IGNORARSE en diario (mandan los días del parte).
      await asignar({ concepto_id: comedor, nino_id: ninos[0], cantidad_default: 5 })
      for (const fecha of ['2026-06-02', '2026-06-03', '2026-06-04']) {
        await serviceClient.from('parte_servicio_diario').insert({
          centro_id: centro.id,
          nino_id: ninos[0],
          fecha,
          servicio: 'comedor',
          presente: true,
        })
      }

      await gen()
      const { lineas } = await reciboRegular(familia, ANIO, MES)
      const l = lineas.find((x) => x.concepto_id === comedor)
      expect(l?.cantidad).toBe(3)
      expect(l?.importe_centimos).toBe(1800) // 600 × 3, no × 5
    })

    it('importe_override sustituye el catálogo y cantidad_default multiplica (mensual)', async () => {
      const { familia, ninos } = await nuevaFamilia(['Override'])
      const cuota = await mkConcepto(centro.id, {
        nombre: 'CuotaOv ' + familia,
        importe_centimos: 20000,
      })
      await asignar({
        concepto_id: cuota,
        nino_id: ninos[0],
        importe_override_centimos: 15000,
        cantidad_default: 2,
      })
      await gen()
      const { lineas } = await reciboRegular(familia, ANIO, MES)
      const l = lineas.find((x) => x.concepto_id === cuota)
      expect(l?.cantidad).toBe(2)
      expect(l?.importe_centimos).toBe(30000) // 15000 × 2
    })

    it('vigencia caducada → sin línea ese mes', async () => {
      const { familia, ninos } = await nuevaFamilia(['Caducado'])
      const cuota = await mkConcepto(centro.id, {
        nombre: 'CuotaVig ' + familia,
        importe_centimos: 20000,
      })
      // vigencia hasta mayo → NO aplica en junio.
      await asignar({ concepto_id: cuota, nino_id: ninos[0], vigencia_hasta: '2026-05-31' })
      await gen()
      const { recibo } = await reciboRegular(familia, ANIO, MES)
      expect(recibo).toBeNull() // sin líneas → descartado
    })

    it('beca activa → línea negativa colgada del hijo', async () => {
      const { familia, ninos } = await nuevaFamilia(['Becado'])
      const cuota = await mkConcepto(centro.id, {
        nombre: 'CuotaB ' + familia,
        importe_centimos: 20000,
      })
      await asignar({ concepto_id: cuota, nino_id: ninos[0] })
      const { data: tb } = await serviceClient
        .from('tipos_beca')
        .insert({ centro_id: centro.id, nombre: 'Beca ' + familia })
        .select('id')
        .single()
      await serviceClient.from('becas').insert({
        centro_id: centro.id,
        nino_id: ninos[0],
        tipo_beca_id: tb!.id,
        importe_centimos: 5000,
        fecha_desde: '2026-06-01',
      })
      await gen()
      const { recibo, lineas } = await reciboRegular(familia, ANIO, MES)
      const beca = lineas.find((l) => l.descripcion?.toString().startsWith('Beca:'))
      expect(beca?.importe_centimos).toBe(-5000)
      expect(beca?.nino_id).toBe(ninos[0])
      expect(recibo?.total_centimos).toBe(15000) // 20000 − 5000
    })

    it('descuento hermanos %: el que más paga sin descuento; el resto línea negativa del hijo', async () => {
      const { familia, ninos } = await nuevaFamilia(['Mayor', 'Menor'])
      const cuota = await mkConcepto(centro.id, {
        nombre: 'CuotaH ' + familia,
        importe_centimos: 10000,
      })
      // Mayor paga 30000 (override), Menor 20000.
      await asignar({ concepto_id: cuota, nino_id: ninos[0], importe_override_centimos: 30000 })
      await asignar({ concepto_id: cuota, nino_id: ninos[1], importe_override_centimos: 20000 })
      const desc = await mkConcepto(centro.id, {
        nombre: 'Descuento hermanos ' + familia,
        signo: -1,
        ambito: 'familia',
        tipo_valor: 'porcentaje',
        porcentaje_bp: 1000, // 10%
        concepto_base_id: cuota,
      })
      await asignar({ concepto_id: desc, familia_id: familia })
      await gen()
      const { lineas } = await reciboRegular(familia, ANIO, MES)
      const descuentos = lineas.filter((l) => l.concepto_id === desc)
      expect(descuentos).toHaveLength(1)
      expect(descuentos[0]!.nino_id).toBe(ninos[1]) // el Menor (paga menos)
      expect(descuentos[0]!.importe_centimos).toBe(-2000) // 10% de 20000
    })

    it('descuento hermanos % con empate → un único primero, determinista', async () => {
      const { familia, ninos } = await nuevaFamilia(['EmpA', 'EmpB'])
      const cuota = await mkConcepto(centro.id, {
        nombre: 'CuotaE ' + familia,
        importe_centimos: 20000,
      })
      await asignar({ concepto_id: cuota, nino_id: ninos[0] })
      await asignar({ concepto_id: cuota, nino_id: ninos[1] })
      const desc = await mkConcepto(centro.id, {
        nombre: 'DescEmp ' + familia,
        signo: -1,
        ambito: 'familia',
        tipo_valor: 'porcentaje',
        porcentaje_bp: 1000,
        concepto_base_id: cuota,
      })
      await asignar({ concepto_id: desc, familia_id: familia })
      await gen()
      const primera = (await reciboRegular(familia, ANIO, MES)).lineas.filter(
        (l) => l.concepto_id === desc
      )
      expect(primera).toHaveLength(1)
      const ninoDescontado = primera[0]!.nino_id
      // Regenerar → mismo hijo descontado (determinista por nino_id).
      await gen()
      const segunda = (await reciboRegular(familia, ANIO, MES)).lineas.filter(
        (l) => l.concepto_id === desc
      )
      expect(segunda).toHaveLength(1)
      expect(segunda[0]!.nino_id).toBe(ninoDescontado)
    })

    it('descuento fijo hermanos: una línea por hermano adicional', async () => {
      const { familia, ninos } = await nuevaFamilia(['F1', 'F2', 'F3'])
      const cuota = await mkConcepto(centro.id, {
        nombre: 'CuotaF ' + familia,
        importe_centimos: 20000,
      })
      for (const n of ninos) await asignar({ concepto_id: cuota, nino_id: n })
      const desc = await mkConcepto(centro.id, {
        nombre: 'DescFijo ' + familia,
        signo: -1,
        ambito: 'familia',
        tipo_valor: 'fijo',
        importe_centimos: 5000,
      })
      await asignar({ concepto_id: desc, familia_id: familia })
      await gen()
      const descuentos = (await reciboRegular(familia, ANIO, MES)).lineas.filter(
        (l) => l.concepto_id === desc
      )
      expect(descuentos).toHaveLength(2) // 3 hijos → 2 no-primeros
      expect(descuentos.every((l) => l.importe_centimos === -5000)).toBe(true)
    })

    it('descuento niño-scoped (R12): % sobre la base de ESE hijo', async () => {
      const { familia, ninos } = await nuevaFamilia(['Indiv'])
      const cuota = await mkConcepto(centro.id, {
        nombre: 'CuotaI ' + familia,
        importe_centimos: 30000,
      })
      await asignar({ concepto_id: cuota, nino_id: ninos[0] })
      const desc = await mkConcepto(centro.id, {
        nombre: 'DescIndiv ' + familia,
        signo: -1,
        ambito: 'nino',
        tipo_valor: 'porcentaje',
        porcentaje_bp: 1000,
        concepto_base_id: cuota,
      })
      await asignar({ concepto_id: desc, nino_id: ninos[0] })
      await gen()
      const l = (await reciboRegular(familia, ANIO, MES)).lineas.find((x) => x.concepto_id === desc)
      expect(l?.nino_id).toBe(ninos[0])
      expect(l?.importe_centimos).toBe(-3000) // 10% de 30000
    })

    // ── PASE 1b: cargos POSITIVOS de ámbito FAMILIA (hueco cerrado) ────────────
    it('concepto familia + signo=+1 mensual → 1 línea familiar (nino_id NULL) y suma al total', async () => {
      const { familia, ninos } = await nuevaFamilia(['Fam1a', 'Fam1b'])
      const cuota = await mkConcepto(centro.id, {
        nombre: 'CuotaFam ' + familia,
        importe_centimos: 20000,
      })
      await asignar({ concepto_id: cuota, nino_id: ninos[0] })
      await asignar({ concepto_id: cuota, nino_id: ninos[1] })
      // Concepto de ámbito FAMILIA, positivo, fijo, mensual (p.ej. servicio común de la familia).
      const comun = await mkConcepto(centro.id, {
        nombre: 'Servicio común ' + familia,
        ambito: 'familia',
        importe_centimos: 8000,
      })
      await asignar({ concepto_id: comun, familia_id: familia })
      await gen()
      const { recibo, lineas } = await reciboRegular(familia, ANIO, MES)
      const familiar = lineas.filter((l) => l.concepto_id === comun)
      expect(familiar).toHaveLength(1)
      expect(familiar[0]!.nino_id).toBeNull() // cargo familiar, no de un hijo
      expect(familiar[0]!.importe_centimos).toBe(8000)
      expect(familiar[0]!.descripcion).toBe('Servicio común ' + familia) // sin "· hijo"
      expect(recibo?.total_centimos).toBe(48000) // 20000 + 20000 + 8000
    })

    it('concepto familia + signo=+1: override y cantidad_default multiplican', async () => {
      const { familia, ninos } = await nuevaFamilia(['FamOv'])
      const cuota = await mkConcepto(centro.id, {
        nombre: 'CuotaFamOv ' + familia,
        importe_centimos: 20000,
      })
      await asignar({ concepto_id: cuota, nino_id: ninos[0] })
      const comun = await mkConcepto(centro.id, {
        nombre: 'ComunOv ' + familia,
        ambito: 'familia',
        importe_centimos: 5000,
      })
      await asignar({
        concepto_id: comun,
        familia_id: familia,
        importe_override_centimos: 3000,
        cantidad_default: 4,
      })
      await gen()
      const l = (await reciboRegular(familia, ANIO, MES)).lineas.find(
        (x) => x.concepto_id === comun
      )
      expect(l?.nino_id).toBeNull()
      expect(l?.cantidad).toBe(4)
      expect(l?.importe_centimos).toBe(12000) // 3000 × 4 (override × cantidad_default)
    })

    it('concepto familia + signo=+1 fuera de vigencia → sin línea familiar', async () => {
      const { familia, ninos } = await nuevaFamilia(['FamVig'])
      const cuota = await mkConcepto(centro.id, {
        nombre: 'CuotaFamVig ' + familia,
        importe_centimos: 20000,
      })
      await asignar({ concepto_id: cuota, nino_id: ninos[0] })
      const comun = await mkConcepto(centro.id, {
        nombre: 'ComunVig ' + familia,
        ambito: 'familia',
        importe_centimos: 5000,
      })
      // vigencia hasta mayo → NO aplica en junio.
      await asignar({ concepto_id: comun, familia_id: familia, vigencia_hasta: '2026-05-31' })
      await gen()
      const familiar = (await reciboRegular(familia, ANIO, MES)).lineas.filter(
        (l) => l.concepto_id === comun
      )
      expect(familiar).toHaveLength(0)
    })

    it('la línea familiar (nino_id NULL) NO entra en la base del descuento hermanos', async () => {
      const { familia, ninos } = await nuevaFamilia(['BaseA', 'BaseB'])
      const cuota = await mkConcepto(centro.id, {
        nombre: 'CuotaBase ' + familia,
        importe_centimos: 20000,
      })
      await asignar({ concepto_id: cuota, nino_id: ninos[0] })
      await asignar({ concepto_id: cuota, nino_id: ninos[1] })
      // Cargo familiar positivo grande (50000): no debe contaminar la base de ningún hijo.
      const comun = await mkConcepto(centro.id, {
        nombre: 'ComunBase ' + familia,
        ambito: 'familia',
        importe_centimos: 50000,
      })
      await asignar({ concepto_id: comun, familia_id: familia })
      const desc = await mkConcepto(centro.id, {
        nombre: 'DescBase ' + familia,
        signo: -1,
        ambito: 'familia',
        tipo_valor: 'porcentaje',
        porcentaje_bp: 1000, // 10%
        concepto_base_id: cuota,
      })
      await asignar({ concepto_id: desc, familia_id: familia })
      await gen()
      const descuentos = (await reciboRegular(familia, ANIO, MES)).lineas.filter(
        (l) => l.concepto_id === desc
      )
      expect(descuentos).toHaveLength(1)
      // 10% de 20000 (base del hijo), NO de 70000 (que incluiría el cargo familiar de 50000).
      expect(descuentos[0]!.importe_centimos).toBe(-2000)
    })

    it('familia con 1 hijo + descuento hermanos asignado → sin línea de descuento', async () => {
      const { familia, ninos } = await nuevaFamilia(['Solo'])
      const cuota = await mkConcepto(centro.id, {
        nombre: 'CuotaS ' + familia,
        importe_centimos: 20000,
      })
      await asignar({ concepto_id: cuota, nino_id: ninos[0] })
      const desc = await mkConcepto(centro.id, {
        nombre: 'DescSolo ' + familia,
        signo: -1,
        ambito: 'familia',
        tipo_valor: 'porcentaje',
        porcentaje_bp: 1000,
        concepto_base_id: cuota,
      })
      await asignar({ concepto_id: desc, familia_id: familia })
      await gen()
      const descuentos = (await reciboRegular(familia, ANIO, MES)).lineas.filter(
        (l) => l.concepto_id === desc
      )
      expect(descuentos).toHaveLength(0)
    })

    it('descarte: familia sin asignaciones → sin recibo', async () => {
      const { familia } = await nuevaFamilia(['Vacio'])
      await gen()
      const { recibo } = await reciboRegular(familia, ANIO, MES)
      expect(recibo).toBeNull()
    })

    it('idempotencia: regenerar 2 veces = mismo total y nº de líneas', async () => {
      const { familia, ninos } = await nuevaFamilia(['Idem'])
      const cuota = await mkConcepto(centro.id, {
        nombre: 'CuotaId ' + familia,
        importe_centimos: 12345,
      })
      await asignar({ concepto_id: cuota, nino_id: ninos[0] })
      await gen()
      const a = await reciboRegular(familia, ANIO, MES)
      await gen()
      const b = await reciboRegular(familia, ANIO, MES)
      expect(b.recibo?.total_centimos).toBe(a.recibo?.total_centimos)
      expect(b.lineas.length).toBe(a.lineas.length)
    })

    it('saldo del mes anterior → línea familiar en el mes actual', async () => {
      const familia = await createTestFamilia(centro.id)
      const nino = await insertarNino(centro.id, familia, 'Saldo')
      await matricular(nino, aula.id, curso.id)
      const cuota = await mkConcepto(centro.id, {
        nombre: 'CuotaSal ' + familia,
        importe_centimos: 10000,
      })
      await asignar({ concepto_id: cuota, nino_id: nino })
      const { data: tb } = await serviceClient
        .from('tipos_beca')
        .insert({ centro_id: centro.id, nombre: 'BecaSal ' + familia })
        .select('id')
        .single()
      // Mayo: beca 30000 > cuota 10000 → total −20000 (saldo a favor). Beca solo en mayo.
      await serviceClient.from('becas').insert({
        centro_id: centro.id,
        nino_id: nino,
        tipo_beca_id: tb!.id,
        importe_centimos: 30000,
        fecha_desde: '2026-05-01',
        fecha_hasta: '2026-05-31',
      })
      await cAdmin.rpc('generar_recibos_mes', { p_centro_id: centro.id, p_anio: 2026, p_mes: 5 })
      const mayo = await reciboRegular(familia, 2026, 5)
      expect(mayo.recibo?.total_centimos).toBe(-20000)
      // Junio: cuota 10000 + saldo −20000.
      await gen()
      const junio = await reciboRegular(familia, ANIO, MES)
      const saldo = junio.lineas.find((l) => l.descripcion === 'Saldo mes anterior')
      expect(saldo?.importe_centimos).toBe(-20000)
      expect(saldo?.nino_id).toBeNull() // línea familiar
    })

    it('authz: un no-admin no puede generar', async () => {
      const tutor = await createTestUser({ nombre: 'Tutor F43' })
      const cTutor = await clientFor(tutor)
      const r = await cTutor.rpc('generar_recibos_mes', {
        p_centro_id: centro.id,
        p_anio: ANIO,
        p_mes: MES,
      })
      expect(r.error).not.toBeNull()
      await deleteTestUser(tutor.id)
    })
  })

  // ── Bloque B: confirmación por recibo + congelado por estado + esporádico ────
  describe('confirmación, congelado y esporádico', () => {
    let centro: { id: string }
    let curso: { id: string }
    let aula: { id: string }
    let admin: TestUser
    let cAdmin: Awaited<ReturnType<typeof clientFor>>
    let f1: string // 2 hijos
    let f2: string // 1 hijo

    beforeAll(async () => {
      centro = await createTestCentro('Centro F43 conf')
      curso = await createTestCurso(centro.id)
      aula = await createTestAula(centro.id, curso.id)
      admin = await createTestUser({ nombre: 'Admin F43 conf' })
      await asignarRol(admin.id, centro.id, 'admin')
      cAdmin = await clientFor(admin)

      const cuota = await mkConcepto(centro.id, { nombre: 'Cuota conf', importe_centimos: 20000 })
      f1 = await createTestFamilia(centro.id)
      for (const nombre of ['C1a', 'C1b']) {
        const id = await insertarNino(centro.id, f1, nombre)
        await matricular(id, aula.id, curso.id)
        await asignar({ concepto_id: cuota, nino_id: id })
      }
      f2 = await createTestFamilia(centro.id)
      const n2 = await insertarNino(centro.id, f2, 'C2')
      await matricular(n2, aula.id, curso.id)
      await asignar({ concepto_id: cuota, nino_id: n2 })
    })

    afterAll(async () => {
      await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
      await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
      await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
      await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
      await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
      await deleteTestCentro(centro.id)
      await deleteTestUser(admin.id)
    })

    it('confirmar_recibo ancla cierre_mensual cuando no quedan borradores', async () => {
      const mes = 7
      await cAdmin.rpc('generar_recibos_mes', { p_centro_id: centro.id, p_anio: 2026, p_mes: mes })
      const r1 = await reciboRegular(f1, 2026, mes)
      const r2 = await reciboRegular(f2, 2026, mes)

      const c1 = await cAdmin.rpc('confirmar_recibo', { p_recibo_id: r1.recibo!.id })
      expect(c1.error).toBeNull()
      expect(c1.data).toBe(false) // aún queda f2 en borrador

      const c2 = await cAdmin.rpc('confirmar_recibo', { p_recibo_id: r2.recibo!.id })
      expect(c2.error).toBeNull()
      expect(c2.data).toBe(true) // último → mes cerrado

      const { data: cierre } = await serviceClient
        .from('cierre_mensual')
        .select('id')
        .eq('centro_id', centro.id)
        .eq('anio', 2026)
        .eq('mes', mes)
        .maybeSingle()
      expect(cierre).not.toBeNull()
    })

    it('regenerar NO toca un recibo confirmado (R8)', async () => {
      const mes = 8
      await cAdmin.rpc('generar_recibos_mes', { p_centro_id: centro.id, p_anio: 2026, p_mes: mes })
      const r1 = await reciboRegular(f1, 2026, mes)
      await cAdmin.rpc('confirmar_recibo', { p_recibo_id: r1.recibo!.id })
      // Regenerar: f1 confirmado intacto (mismo id, pendiente), f2 sigue borrador; sin cierre.
      const g = await cAdmin.rpc('generar_recibos_mes', {
        p_centro_id: centro.id,
        p_anio: 2026,
        p_mes: mes,
      })
      expect(g.error).toBeNull()
      const r1b = await reciboRegular(f1, 2026, mes)
      expect(r1b.recibo!.id).toBe(r1.recibo!.id)
      expect(r1b.recibo!.estado).toBe('pendiente_procesar')
      const r2b = await reciboRegular(f2, 2026, mes)
      expect(r2b.recibo!.estado).toBe('borrador')
    })

    it('congelado por estado: líneas de un confirmado no editables; las de un borrador sí', async () => {
      const mes = 9
      await cAdmin.rpc('generar_recibos_mes', { p_centro_id: centro.id, p_anio: 2026, p_mes: mes })
      const rConf = await reciboRegular(f1, 2026, mes)
      await cAdmin.rpc('confirmar_recibo', { p_recibo_id: rConf.recibo!.id })
      const rBorr = await reciboRegular(f2, 2026, mes)

      // El congelado exime a service_role → las aserciones van con cAdmin (authenticated).
      // Confirmado: insertar línea → rechazado (trigger P0001).
      const bloqueado = await cAdmin
        .from('lineas_recibo')
        .insert({
          centro_id: centro.id,
          recibo_id: rConf.recibo!.id,
          descripcion: 'intento',
          cantidad: 1,
          precio_unitario_centimos: 100,
          importe_centimos: 100,
        } as LineaInsert)
        .select('id')
      expect(bloqueado.error).not.toBeNull()

      // Borrador: editar una línea → permitido.
      const { data: lineaBorr } = await serviceClient
        .from('lineas_recibo')
        .select('id')
        .eq('recibo_id', rBorr.recibo!.id)
        .limit(1)
        .single()
      const permitido = await cAdmin
        .from('lineas_recibo')
        .update({ descripcion: 'editada' })
        .eq('id', lineaBorr!.id)
        .select('id')
      expect(permitido.error).toBeNull()
    })

    it('crear_recibo_esporadico familiar (nace directo, es_esporadico)', async () => {
      const r = await cAdmin.rpc('crear_recibo_esporadico', {
        p_centro_id: centro.id,
        p_familia_id: f2,
        p_nino_id: null as unknown as string,
        p_anio: 2026,
        p_mes: 11,
        p_concepto: 'Uniforme',
        p_metodo: 'efectivo',
        p_lineas: [{ descripcion: 'Babi', cantidad: 2, precio_unitario_centimos: 1500 }],
      })
      expect(r.error).toBeNull()
      const { data: recibo } = await serviceClient
        .from('recibos')
        .select('familia_id, es_esporadico, estado, total_centimos')
        .eq('id', r.data as string)
        .single()
      expect(recibo?.familia_id).toBe(f2)
      expect(recibo?.es_esporadico).toBe(true)
      expect(recibo?.estado).toBe('pendiente_procesar')
      expect(recibo?.total_centimos).toBe(3000)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// D-6 — beca comedor variable por mes en el MOTOR (D-6-2).
// La beca de `beca_comedor_mes` (importe en EUROS, positivo) se aplica como línea
// NEGATIVA independiente por niño: descripcion "Beca comedor · <nombre>",
// importe_centimos = -round(importe*100), concepto_id NULL, colgada del hijo.
// Gateado por F43 (motor) Y D6 (tabla + PASE 2-bis aplicados).
// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!APPLIED || !D6)('D-6 — beca comedor variable en el motor de recibos', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  const ANIO = 2026
  const MES = 6

  beforeAll(async () => {
    centro = await createTestCentro('Centro D6 motor')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin D6 motor' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
  })

  afterAll(async () => {
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('beca_comedor_mes').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  })

  async function nuevaFamilia(nombres: string[]): Promise<{ familia: string; ninos: string[] }> {
    const familia = await createTestFamilia(centro.id)
    const ninos: string[] = []
    for (const nombre of nombres) {
      const id = await insertarNino(centro.id, familia, nombre)
      await matricular(id, aula.id, curso.id)
      ninos.push(id)
    }
    return { familia, ninos }
  }

  async function mkCuota(nombre: string, importe_centimos: number): Promise<string> {
    return mkConcepto(centro.id, { nombre, importe_centimos })
  }

  async function ponerBeca(ninoId: string, mes: number, importeEuros: number): Promise<void> {
    const { error } = await serviceClient
      .from('beca_comedor_mes')
      .insert({ centro_id: centro.id, nino_id: ninoId, anio: ANIO, mes, importe: importeEuros })
    if (error) throw new Error(`ponerBeca: ${error.message}`)
  }

  const gen = () =>
    cAdmin.rpc('generar_recibos_mes', { p_centro_id: centro.id, p_anio: ANIO, p_mes: MES })

  it('niño con beca_comedor_mes → línea "Beca comedor · <nombre>" con importe_centimos = -importe*100', async () => {
    const { familia, ninos } = await nuevaFamilia(['Nora'])
    const cuota = await mkCuota('CuotaBC ' + familia, 20000)
    await asignar({ concepto_id: cuota, nino_id: ninos[0] })
    await ponerBeca(ninos[0], MES, 30) // 30 € → −3000 céntimos

    const r = await gen()
    expect(r.error).toBeNull()

    const { recibo, lineas } = await reciboRegular(familia, ANIO, MES)
    const beca = lineas.find((l) => l.descripcion === 'Beca comedor · Nora')
    expect(beca).toBeDefined()
    expect(beca?.importe_centimos).toBe(-3000)
    expect(beca?.nino_id).toBe(ninos[0]) // colgada del hijo
    expect(beca?.concepto_id).toBeNull() // línea independiente, sin concepto
    // Total = cuota (20000) − beca comedor (3000).
    expect(recibo?.total_centimos).toBe(17000)
  })

  it('niño SIN fila en beca_comedor_mes → NO aparece línea de beca comedor', async () => {
    const { familia, ninos } = await nuevaFamilia(['SinBeca'])
    const cuota = await mkCuota('CuotaSB ' + familia, 20000)
    await asignar({ concepto_id: cuota, nino_id: ninos[0] })
    // No se registra beca_comedor_mes para este niño/mes.

    await gen()
    const { recibo, lineas } = await reciboRegular(familia, ANIO, MES)
    const becas = lineas.filter((l) => l.descripcion?.toString().startsWith('Beca comedor · '))
    expect(becas).toHaveLength(0)
    expect(recibo?.total_centimos).toBe(20000) // sin descuento de beca comedor
  })

  it('el total baja exactamente importe*100 respecto a la suma de líneas positivas', async () => {
    const { familia, ninos } = await nuevaFamilia(['Pau'])
    const cuota = await mkCuota('CuotaTot ' + familia, 25000)
    const extra = await mkCuota('ExtraTot ' + familia, 5000)
    await asignar({ concepto_id: cuota, nino_id: ninos[0] })
    await asignar({ concepto_id: extra, nino_id: ninos[0] })
    await ponerBeca(ninos[0], MES, 42.5) // 42,50 € → −4250 céntimos

    await gen()
    const { recibo, lineas } = await reciboRegular(familia, ANIO, MES)
    const positivas = lineas
      .filter((l) => Number(l.importe_centimos) > 0)
      .reduce((s, l) => s + Number(l.importe_centimos), 0)
    const beca = lineas.find((l) => l.descripcion === 'Beca comedor · Pau')
    expect(positivas).toBe(30000) // 25000 + 5000
    expect(beca?.importe_centimos).toBe(-4250)
    expect(recibo?.total_centimos).toBe(positivas - 4250) // 30000 − 4250 = 25750
  })
})
