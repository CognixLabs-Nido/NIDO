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
 * B1-1 — MOTOR: importe unitario por AÑO DE NACIMIENTO.
 *
 * Verifica que generar_recibos_mes resuelve v_unit de los cargos POSITIVOS por niño
 * (PASE 1) con la precedencia cerrada por Jose: override manual del niño > tarifa por año
 * (si el concepto tiene el flag `tarifa_por_anio_nacimiento`) > base. Cubre:
 *  - dos niños de años distintos toman cada uno SU tarifa del año (mensual);
 *  - el override manual gana sobre la tarifa del año;
 *  - sin fila (concepto_id, año) → cae a la base (fallback, sin error);
 *  - concepto SIN flag → base aunque exista una tarifa por año para ese año;
 *  - diario: el unitario (precio/día) es la tarifa del año y se multiplica por los días
 *    del parte.
 *
 * Requiere B1-0 (flag + tabla tarifa_concepto_anio) Y B1-1 (motor) aplicadas.
 * Gateado: B1_MOTOR_TARIFA_ANIO_APPLIED=1.
 */

const APPLIED = process.env.B1_MOTOR_TARIFA_ANIO_APPLIED === '1'

type AsignacionInsert = Database['public']['Tables']['asignacion_concepto']['Insert']

// ── helpers de siembra (serviceClient bypassa RLS, no los CHECK) ──────────────
async function insertarNino(
  centroId: string,
  familiaId: string,
  nombre: string,
  fechaNacimiento: string
): Promise<string> {
  const { data, error } = await serviceClient
    .from('ninos')
    .insert({
      centro_id: centroId,
      familia_id: familiaId,
      nombre,
      apellidos: 'Test',
      fecha_nacimiento: fechaNacimiento,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`insertarNino: ${error?.message}`)
  return data.id
}

interface MkConcepto {
  nombre: string
  tipo_concepto?: 'mensual' | 'diario'
  importe_centimos: number
  tarifa_por_anio_nacimiento?: boolean
  servicio?: 'comedor' | 'matinera' | 'vespertina' | null
}

async function mkConcepto(centroId: string, o: MkConcepto): Promise<string> {
  const { data, error } = await serviceClient
    .from('conceptos_cobro')
    .insert({
      centro_id: centroId,
      nombre: o.nombre,
      tipo_concepto: o.tipo_concepto ?? 'mensual',
      tipo_valor: 'fijo',
      signo: 1,
      ambito: 'nino',
      aplicacion: 'automatico',
      importe_centimos: o.importe_centimos,
      tarifa_por_anio_nacimiento: o.tarifa_por_anio_nacimiento ?? false,
      servicio: o.servicio ?? null,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`mkConcepto ${o.nombre}: ${error?.message}`)
  return data.id
}

async function seedTarifa(
  centroId: string,
  conceptoId: string,
  anio: number,
  importe: number
): Promise<void> {
  const { error } = await serviceClient.from('tarifa_concepto_anio').insert({
    centro_id: centroId,
    concepto_id: conceptoId,
    anio_nacimiento: anio,
    importe_centimos: importe,
  })
  if (error) throw new Error(`seedTarifa: ${error.message}`)
}

async function asignar(row: Partial<AsignacionInsert> & { concepto_id: string }): Promise<void> {
  const { error } = await serviceClient
    .from('asignacion_concepto')
    .insert({ origen: 'manual', ...row } as AsignacionInsert)
  if (error) throw new Error(`asignar: ${error.message}`)
}

async function lineasDe(familiaId: string, anio: number, mes: number) {
  const { data: recibo } = await serviceClient
    .from('recibos')
    .select('id')
    .eq('familia_id', familiaId)
    .eq('anio', anio)
    .eq('mes', mes)
    .eq('es_esporadico', false)
    .is('devuelto_de_recibo_id', null)
    .is('deleted_at', null)
    .maybeSingle()
  if (!recibo) return [] as Array<Record<string, unknown>>
  const { data: lineas } = await serviceClient
    .from('lineas_recibo')
    .select('nino_id, concepto_id, cantidad, precio_unitario_centimos, importe_centimos')
    .eq('recibo_id', recibo.id)
  return lineas ?? []
}

describe.skipIf(!APPLIED)('B1-1 — motor: importe unitario por año de nacimiento', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  const ANIO = 2026
  const MES = 9

  beforeAll(async () => {
    centro = await createTestCentro('Centro B1-1 motor')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin B1-1' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
  })

  afterAll(async () => {
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('parte_servicio_diario').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('tarifa_concepto_anio').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  })

  async function nuevoNino(fechaNacimiento: string): Promise<{ familia: string; nino: string }> {
    const familia = await createTestFamilia(centro.id)
    const nino = await insertarNino(centro.id, familia, 'N', fechaNacimiento)
    await matricular(nino, aula.id, curso.id)
    return { familia, nino }
  }

  const gen = () =>
    cAdmin.rpc('generar_recibos_mes', { p_centro_id: centro.id, p_anio: ANIO, p_mes: MES })

  it('dos años distintos toman cada uno SU tarifa del año (mensual)', async () => {
    // Misma familia, dos hijos: uno 2024, otro 2025, mismo concepto flag-activo.
    const familia = await createTestFamilia(centro.id)
    const nino24 = await insertarNino(centro.id, familia, 'Nace2024', '2024-05-10')
    const nino25 = await insertarNino(centro.id, familia, 'Nace2025', '2025-02-20')
    await matricular(nino24, aula.id, curso.id)
    await matricular(nino25, aula.id, curso.id)
    const concepto = await mkConcepto(centro.id, {
      nombre: 'Escolaridad ' + familia,
      importe_centimos: 10000, // base — no debe usarse
      tarifa_por_anio_nacimiento: true,
    })
    await seedTarifa(centro.id, concepto, 2024, 50000)
    await seedTarifa(centro.id, concepto, 2025, 60000)
    await asignar({ concepto_id: concepto, nino_id: nino24 })
    await asignar({ concepto_id: concepto, nino_id: nino25 })

    const r = await gen()
    expect(r.error).toBeNull()

    const lineas = await lineasDe(familia, ANIO, MES)
    const l24 = lineas.find((l) => l.nino_id === nino24)
    const l25 = lineas.find((l) => l.nino_id === nino25)
    expect(l24?.precio_unitario_centimos).toBe(50000)
    expect(l24?.importe_centimos).toBe(50000)
    expect(l25?.precio_unitario_centimos).toBe(60000)
    expect(l25?.importe_centimos).toBe(60000)
  })

  it('el override manual del niño gana sobre la tarifa del año', async () => {
    const { familia, nino } = await nuevoNino('2024-08-01')
    const concepto = await mkConcepto(centro.id, {
      nombre: 'Escolaridad ov ' + familia,
      importe_centimos: 10000,
      tarifa_por_anio_nacimiento: true,
    })
    await seedTarifa(centro.id, concepto, 2024, 50000) // tarifa del año
    await asignar({ concepto_id: concepto, nino_id: nino, importe_override_centimos: 77700 })

    await gen()
    const lineas = await lineasDe(familia, ANIO, MES)
    const l = lineas.find((x) => x.concepto_id === concepto)
    expect(l?.precio_unitario_centimos).toBe(77700) // override, no 50000
    expect(l?.importe_centimos).toBe(77700)
  })

  it('sin fila (concepto, año) → cae a la base, sin error', async () => {
    const { familia, nino } = await nuevoNino('1999-01-01') // no habrá tarifa para 1999
    const concepto = await mkConcepto(centro.id, {
      nombre: 'Escolaridad base ' + familia,
      importe_centimos: 10000,
      tarifa_por_anio_nacimiento: true,
    })
    await seedTarifa(centro.id, concepto, 2024, 50000) // existe 2024, no 1999
    await asignar({ concepto_id: concepto, nino_id: nino })

    await gen()
    const lineas = await lineasDe(familia, ANIO, MES)
    const l = lineas.find((x) => x.concepto_id === concepto)
    expect(l?.precio_unitario_centimos).toBe(10000) // base
    expect(l?.importe_centimos).toBe(10000)
  })

  it('concepto SIN flag → base, aunque exista una tarifa por año', async () => {
    const { familia, nino } = await nuevoNino('2024-03-15')
    const concepto = await mkConcepto(centro.id, {
      nombre: 'Escolaridad sinflag ' + familia,
      importe_centimos: 30000,
      tarifa_por_anio_nacimiento: false, // flag OFF
    })
    await seedTarifa(centro.id, concepto, 2024, 88888) // debe ignorarse
    await asignar({ concepto_id: concepto, nino_id: nino })

    await gen()
    const lineas = await lineasDe(familia, ANIO, MES)
    const l = lineas.find((x) => x.concepto_id === concepto)
    expect(l?.precio_unitario_centimos).toBe(30000) // base, no 88888
    expect(l?.importe_centimos).toBe(30000)
  })

  it('diario: el unitario es la tarifa del año y se multiplica por los días del parte', async () => {
    const { familia, nino } = await nuevoNino('2024-11-11')
    const concepto = await mkConcepto(centro.id, {
      nombre: 'Comedor ' + familia,
      tipo_concepto: 'diario',
      importe_centimos: 800, // base/día — no debe usarse
      tarifa_por_anio_nacimiento: true,
      servicio: 'comedor',
    })
    await seedTarifa(centro.id, concepto, 2024, 1000) // tarifa/día del año
    await asignar({ concepto_id: concepto, nino_id: nino, cantidad_default: 5 })
    for (const fecha of ['2026-09-01', '2026-09-02', '2026-09-03']) {
      const { error } = await serviceClient.from('parte_servicio_diario').insert({
        centro_id: centro.id,
        nino_id: nino,
        fecha,
        servicio: 'comedor',
        presente: true,
      })
      if (error) throw new Error(`parte: ${error.message}`)
    }

    await gen()
    const lineas = await lineasDe(familia, ANIO, MES)
    const l = lineas.find((x) => x.concepto_id === concepto)
    expect(l?.precio_unitario_centimos).toBe(1000) // tarifa del año, no base 800
    expect(l?.cantidad).toBe(3) // días del parte (cantidad_default ignorado)
    expect(l?.importe_centimos).toBe(3000) // 1000 × 3
  })
})
