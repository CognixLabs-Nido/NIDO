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
 * PR-6 — importe propio por niño y por familia.
 *
 * El importe propio vive en la ASIGNACIÓN (`asignacion_concepto.importe_override_centimos`) y no
 * en la línea del recibo, que muere con ese recibo: así se arrastra solo cada mes hasta que la
 * directora lo cambie. Aquí se mide contra la BD lo que la pantalla escribe (el mismo UPDATE que
 * `fijarImportePropio`, con la sesión de Dirección):
 *  - se cobra ese importe en dos meses seguidos, y el resto de niños sigue pagando el del concepto;
 *  - manda sobre la tarifa por año de nacimiento; en un diario es el precio por día;
 *  - el descuento por hermano puede ser distinto en cada familia (García 30 €, Pérez 50 €);
 *  - quitarlo vuelve al precio del concepto, y una profe no lo puede tocar.
 */

type ConceptoInsert = Database['public']['Tables']['conceptos_cobro']['Insert']

const ANIO = 2026

describe('PR-6 — el importe propio se fija en la asignación y se arrastra cada mes', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let profe: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  let cProfe: Awaited<ReturnType<typeof clientFor>>

  async function familiaConNinos(n: number): Promise<{ familia: string; ninos: string[] }> {
    const familia = await createTestFamilia(centro.id)
    const ninos: string[] = []
    for (let i = 0; i < n; i++) {
      const { data, error } = await serviceClient
        .from('ninos')
        .insert({
          centro_id: centro.id,
          familia_id: familia,
          nombre: `Nino PR6 ${i}`,
          apellidos: 'Test',
          fecha_nacimiento: '2024-03-15',
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(`nino: ${error?.message}`)
      await matricular(data.id, aula.id, curso.id)
      ninos.push(data.id)
    }
    return { familia, ninos }
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

  async function asignar(
    conceptoId: string,
    destino: { nino_id: string } | { familia_id: string }
  ) {
    const { error } = await serviceClient
      .from('asignacion_concepto')
      .insert({ centro_id: centro.id, concepto_id: conceptoId, origen: 'manual', ...destino })
    if (error) throw new Error(`asignar: ${error.message}`)
  }

  /** El UPDATE de `fijarImportePropio`, con la sesión de quien se pase. */
  function fijar(
    cliente: typeof cAdmin,
    conceptoId: string,
    destino: { nino_id: string } | { familia_id: string },
    centimos: number | null
  ) {
    const [col, id] = Object.entries(destino)[0] as [string, string]
    return cliente
      .from('asignacion_concepto')
      .update({ importe_override_centimos: centimos })
      .eq('centro_id', centro.id)
      .eq('concepto_id', conceptoId)
      .eq(col, id)
      .is('deleted_at', null)
      .select('id')
  }

  async function generar(mes: number) {
    const { error } = await cAdmin.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: mes,
    })
    expect(error).toBeNull()
  }

  async function importes(conceptoId: string, ninoId: string, mes: number) {
    const { data } = await serviceClient
      .from('lineas_recibo')
      .select('importe_centimos, recibo:recibos!recibo_id!inner(anio, mes)')
      .eq('concepto_id', conceptoId)
      .eq('nino_id', ninoId)
      .eq('recibo.anio', ANIO)
      .eq('recibo.mes', mes)
    return (data ?? []).map((l) => l.importe_centimos)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Importe Propio PR6')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Importe Propio PR6' })
    profe = await createTestUser({ nombre: 'Profe Importe Propio PR6' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    cAdmin = await clientFor(admin)
    cProfe = await clientFor(profe)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('tarifa_concepto_anio').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(profe.id)
  }, 60_000)

  it('el importe propio del niño se cobra mes tras mes; el otro niño paga el del concepto', async () => {
    const { ninos } = await familiaConNinos(1)
    const { ninos: otros } = await familiaConNinos(1)
    const cuota = await concepto({ nombre: 'Cuota PR6', importe_centimos: 29000 })
    await asignar(cuota, { nino_id: ninos[0]! })
    await asignar(cuota, { nino_id: otros[0]! })

    // Premisa: sin importe propio, los dos pagan el del concepto.
    await generar(1)
    expect(await importes(cuota, ninos[0]!, 1)).toEqual([29000])

    const r = await fijar(cAdmin, cuota, { nino_id: ninos[0]! }, 20000)
    expect(r.error).toBeNull()
    expect(r.data).toHaveLength(1)

    for (const mes of [2, 3]) {
      await generar(mes)
      expect(await importes(cuota, ninos[0]!, mes)).toEqual([20000])
      expect(await importes(cuota, otros[0]!, mes)).toEqual([29000])
    }
  })

  it('manda sobre la tarifa por año de nacimiento; en un diario es el precio por día', async () => {
    const { ninos } = await familiaConNinos(1)
    const conTarifa = await concepto({
      nombre: 'Cuota por año PR6',
      importe_centimos: 30000,
      tarifa_por_anio_nacimiento: true,
    })
    const tarifa = await serviceClient.from('tarifa_concepto_anio').insert({
      centro_id: centro.id,
      concepto_id: conTarifa,
      anio_nacimiento: 2024,
      importe_centimos: 25000,
    })
    expect(tarifa.error).toBeNull()
    const comedor = await concepto({
      nombre: 'Comedor diario PR6',
      tipo_concepto: 'diario',
      aplicacion: 'automatico',
      importe_centimos: 700,
      servicio: 'comedor',
    })
    await asignar(conTarifa, { nino_id: ninos[0]! })
    await asignar(comedor, { nino_id: ninos[0]! })
    const parte = await serviceClient.from('parte_servicio_diario').insert(
      ['2026-04-07', '2026-04-08'].map((fecha) => ({
        centro_id: centro.id,
        nino_id: ninos[0]!,
        fecha,
        servicio: 'comedor' as const,
        presente: true,
      }))
    )
    expect(parte.error).toBeNull()

    // Premisa: sin importe propio, la tarifa por año (25000) y 700 por día.
    await generar(4)
    expect(await importes(conTarifa, ninos[0]!, 4)).toEqual([25000])
    expect(await importes(comedor, ninos[0]!, 4)).toEqual([1400])

    await fijar(cAdmin, conTarifa, { nino_id: ninos[0]! }, 18000)
    await fijar(cAdmin, comedor, { nino_id: ninos[0]! }, 500)
    await generar(4)
    expect(await importes(conTarifa, ninos[0]!, 4)).toEqual([18000])
    expect(await importes(comedor, ninos[0]!, 4)).toEqual([1000])

    await serviceClient.from('parte_servicio_diario').delete().eq('nino_id', ninos[0]!)
  })

  it('el descuento por hermano, distinto en cada familia: García 30 €, Pérez 50 €', async () => {
    const garcia = await familiaConNinos(2)
    const perez = await familiaConNinos(2)
    const cuota = await concepto({ nombre: 'Cuota hermanos PR6', importe_centimos: 29000 })
    const hermano = await concepto({
      nombre: 'Descuento hermano PR6',
      signo: -1,
      ambito: 'familia',
      importe_centimos: 4000,
    })
    for (const f of [garcia, perez]) {
      for (const n of f.ninos) await asignar(cuota, { nino_id: n })
      await asignar(hermano, { familia_id: f.familia })
    }
    await fijar(cAdmin, hermano, { familia_id: garcia.familia }, 3000)
    await fijar(cAdmin, hermano, { familia_id: perez.familia }, 5000)

    await generar(5)
    const descuentos = async (f: { ninos: string[] }) =>
      (await Promise.all(f.ninos.map((n) => importes(hermano, n, 5)))).flat()
    expect(await descuentos(garcia)).toEqual([-3000])
    expect(await descuentos(perez)).toEqual([-5000])
  })

  it('quitarlo vuelve al precio del concepto; una profe no lo puede tocar', async () => {
    const { ninos } = await familiaConNinos(1)
    const cuota = await concepto({ nombre: 'Cuota quitar PR6', importe_centimos: 29000 })
    await asignar(cuota, { nino_id: ninos[0]! })
    await fijar(cAdmin, cuota, { nino_id: ninos[0]! }, 20000)

    // La profe: la RLS no le deja ver la fila, así que su UPDATE no toca nada.
    const deProfe = await fijar(cProfe, cuota, { nino_id: ninos[0]! }, 1)
    expect(deProfe.data ?? []).toHaveLength(0)
    const { data: fila } = await serviceClient
      .from('asignacion_concepto')
      .select('importe_override_centimos')
      .eq('concepto_id', cuota)
      .eq('nino_id', ninos[0]!)
      .single()
    expect(fila?.importe_override_centimos).toBe(20000)

    await fijar(cAdmin, cuota, { nino_id: ninos[0]! }, null)
    await generar(6)
    expect(await importes(cuota, ninos[0]!, 6)).toEqual([29000])
  })
})
