import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * PR-9 — se elimina la beca vieja (`becas` / `tipos_beca`).
 *
 * Había dos formas de poner una beca de comedor y se podían sumar sin avisar; el control de
 * desborde solo vigilaba la nueva. Queda una: la beca comedor por cargas. Una beca que no es de
 * comedor es un concepto negativo con el importe propio del niño (PR-6). Aquí, contra la BD:
 *  - las dos tablas ya no existen (y la vecina sí, con el mismo cliente);
 *  - el motor descuenta la beca como descuento del niño y no escribe líneas sin concepto (el
 *    PASE 2 era el único que las escribía);
 *  - el export (art. 15) del niño ya no tiene la sección `becas`, y sí sus conceptos asignados.
 */

const ANIO = 2026
const MES = 4

describe('PR-9 — la beca vieja eliminada', () => {
  let centro: { id: string }
  let admin: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  let familia: string
  let nino: string
  let escolaridad: string
  let beca: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro Beca Vieja PR9')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin PR9' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)

    familia = await createTestFamilia(centro.id)
    const n = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        nombre: 'Nino PR9',
        apellidos: 'Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (n.error || !n.data) throw new Error(`nino: ${n.error?.message}`)
    nino = n.data.id
    await matricular(nino, aula.id, curso.id)

    const conceptos = await serviceClient
      .from('conceptos_cobro')
      .insert([
        {
          centro_id: centro.id,
          nombre: 'Escolaridad PR9',
          tipo_concepto: 'mensual',
          tipo_valor: 'fijo',
          signo: 1,
          ambito: 'nino',
          importe_centimos: 50000,
        },
        {
          centro_id: centro.id,
          nombre: 'Beca Conselleria PR9',
          tipo_concepto: 'mensual',
          tipo_valor: 'fijo',
          signo: -1,
          ambito: 'nino',
          importe_centimos: 1000,
        },
      ])
      .select('id, signo')
    if (conceptos.error || conceptos.data?.length !== 2) {
      throw new Error(`conceptos: ${conceptos.error?.message}`)
    }
    escolaridad = conceptos.data.find((c) => c.signo === 1)!.id
    beca = conceptos.data.find((c) => c.signo === -1)!.id
    const asig = await serviceClient.from('asignacion_concepto').insert([
      { centro_id: centro.id, concepto_id: escolaridad, nino_id: nino, origen: 'manual' },
      {
        centro_id: centro.id,
        concepto_id: beca,
        nino_id: nino,
        origen: 'manual',
        importe_override_centimos: 12000,
      },
    ])
    if (asig.error) throw new Error(`asignar: ${asig.error.message}`)
  })

  afterAll(async () => {
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  })

  it('becas y tipos_beca ya no existen; la tabla vecina sí, con el mismo cliente', async () => {
    // Sin tipar: las dos tablas ya no están en `Database`.
    const cliente = serviceClient as unknown as SupabaseClient
    const vecina = await cliente.from('conceptos_cobro').select('id').eq('centro_id', centro.id)
    expect(vecina.error).toBeNull()
    expect(vecina.data).toHaveLength(2)
    for (const tabla of ['becas', 'tipos_beca']) {
      const r = await cliente.from(tabla).select('id').limit(1)
      expect(r.error?.code, tabla).toBe('PGRST205')
      expect(r.error?.message).toContain(`public.${tabla}`)
    }
  })

  it('la beca que no es de comedor es un descuento del niño con su importe propio', async () => {
    const gen = await cAdmin.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: MES,
    })
    expect(gen.error).toBeNull()
    const { data: recibo } = await serviceClient
      .from('recibos')
      .select('id, total_centimos')
      .eq('familia_id', familia)
      .eq('anio', ANIO)
      .eq('mes', MES)
      .eq('es_esporadico', false)
      .single()
    const { data: lineas } = await serviceClient
      .from('lineas_recibo')
      .select('concepto_id, nino_id, importe_centimos')
      .eq('recibo_id', recibo!.id)
    expect(lineas).toHaveLength(2)
    expect(lineas).toContainEqual({ concepto_id: beca, nino_id: nino, importe_centimos: -12000 })
    expect(lineas!.filter((l) => l.concepto_id === null)).toEqual([])
    expect(recibo!.total_centimos).toBe(38000) // 50000 − 12000
  })

  it('el export del niño ya no tiene la sección becas, y sí sus conceptos asignados', async () => {
    const exp = await cAdmin.rpc('export_datos_sujeto', {
      p_sujeto_tipo: 'nino',
      p_sujeto_id: nino,
    })
    expect(exp.error).toBeNull()
    const texto = JSON.stringify(exp.data)
    expect(texto).toContain('"conceptos_asignados"')
    expect(texto).toContain('"importe_especial_centimos":12000')
    expect(texto).not.toContain('"becas"')
  })
})
