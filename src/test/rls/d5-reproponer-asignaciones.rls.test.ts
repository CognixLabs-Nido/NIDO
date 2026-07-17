import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

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
 * D-5 (punto 1) — `reproponer_asignaciones`: "Re-proponer desde cero".
 *
 * Revive las asignaciones origen='automatico' soft-borradas que HOY cumplen la regla del
 * concepto y siembra las que falten, SIN tocar las manuales y sin borrar nada. El guard
 * NOT EXISTS(fila viva) + DISTINCT ON garantiza que una manual viva del mismo par gana
 * (sin duplicado ni violación de UNIQUE). El "Proponer" (proponer_asignaciones) NO cambia.
 *
 * Gate: D5_MIGRATION_APPLIED=1 (requiere 20260804 + phase_f42 aplicadas).
 */

const APPLIED = process.env.D5_MIGRATION_APPLIED === '1'

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

describe.skipIf(!APPLIED)('D-5 punto 1 — reproponer_asignaciones', () => {
  let centro: { id: string }
  let familiaSolo: string
  let ninoSolo: string
  let familiaDoble: string
  let ninoD1: string
  let ninoD2: string
  let cptoNinoAuto: string
  let cptoFamAuto: string
  let cptoDescuento: string
  let admin: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>

  beforeAll(async () => {
    centro = await createTestCentro('Centro D5-1')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)

    familiaSolo = await createTestFamilia(centro.id)
    ninoSolo = await insertarNino(centro.id, familiaSolo, 'Solo')
    await matricular(ninoSolo, aula.id, curso.id)

    familiaDoble = await createTestFamilia(centro.id)
    ninoD1 = await insertarNino(centro.id, familiaDoble, 'Doble 1')
    ninoD2 = await insertarNino(centro.id, familiaDoble, 'Doble 2')
    await matricular(ninoD1, aula.id, curso.id)
    await matricular(ninoD2, aula.id, curso.id)

    const mk = async (nombre: string, ambito: 'nino' | 'familia', signo = 1) => {
      const r = await serviceClient
        .from('conceptos_cobro')
        .insert({
          centro_id: centro.id,
          nombre,
          tipo_concepto: 'mensual',
          tipo_valor: 'fijo',
          importe_centimos: 10000,
          ambito,
          aplicacion: 'automatico',
          signo,
        })
        .select('id')
        .single()
      if (r.error || !r.data) throw new Error(`concepto ${nombre}: ${r.error?.message}`)
      return r.data.id
    }
    cptoNinoAuto = await mk('Cuota niño auto', 'nino')
    cptoFamAuto = await mk('Cuota familia auto', 'familia')
    cptoDescuento = await mk('Descuento hermanos', 'familia', -1)

    admin = await createTestUser({ nombre: 'Admin D5-1' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
  }, 60_000)

  afterEach(async () => {
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
  })

  afterAll(async () => {
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  }, 60_000)

  // Inserta directamente una fila (para preparar estados soft-borrados / manuales vivos).
  async function seedRow(opts: {
    concepto: string
    ninoId?: string
    familiaId?: string
    origen: 'automatico' | 'manual'
    borrada?: boolean
    importe?: number
  }): Promise<string> {
    const { data, error } = await serviceClient
      .from('asignacion_concepto')
      .insert({
        centro_id: centro.id,
        concepto_id: opts.concepto,
        nino_id: opts.ninoId ?? null,
        familia_id: opts.familiaId ?? null,
        origen: opts.origen,
        importe_override_centimos: opts.importe ?? null,
        deleted_at: opts.borrada ? new Date().toISOString() : null,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`seedRow: ${error?.message}`)
    return data.id
  }

  async function vivas(concepto: string, ninoId?: string, familiaId?: string) {
    let q = serviceClient
      .from('asignacion_concepto')
      .select('id, origen, importe_override_centimos, updated_at, deleted_at')
      .eq('concepto_id', concepto)
      .is('deleted_at', null)
    if (ninoId) q = q.eq('nino_id', ninoId)
    if (familiaId) q = q.eq('familia_id', familiaId)
    const { data } = await q
    return data ?? []
  }

  it('revive una auto soft-borrada (la MISMA fila, no una nueva)', async () => {
    const id = await seedRow({
      concepto: cptoNinoAuto,
      ninoId: ninoSolo,
      origen: 'automatico',
      borrada: true,
    })
    const r = await cAdmin.rpc('reproponer_asignaciones', { p_centro_id: centro.id })
    expect(r.error).toBeNull()

    const rows = await vivas(cptoNinoAuto, ninoSolo)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(id) // misma fila revivida, no una nueva
    expect(rows[0].origen).toBe('automatico')
  })

  it('NO revive si hay una manual VIVA del mismo par: la manual gana, sin error ni duplicado', async () => {
    const autoId = await seedRow({
      concepto: cptoNinoAuto,
      ninoId: ninoSolo,
      origen: 'automatico',
      borrada: true,
    })
    const manualId = await seedRow({
      concepto: cptoNinoAuto,
      ninoId: ninoSolo,
      origen: 'manual',
      importe: 777,
    })

    const r = await cAdmin.rpc('reproponer_asignaciones', { p_centro_id: centro.id })
    expect(r.error).toBeNull() // sin violación de UNIQUE

    const rows = await vivas(cptoNinoAuto, ninoSolo)
    expect(rows).toHaveLength(1) // solo una viva: la manual
    expect(rows[0].id).toBe(manualId)
    expect(rows[0].origen).toBe('manual')

    // La auto sigue soft-borrada (no se resucitó).
    const { data: auto } = await serviceClient
      .from('asignacion_concepto')
      .select('deleted_at')
      .eq('id', autoId)
      .single()
    expect(auto!.deleted_at).not.toBeNull()
  })

  it('NO toca las manuales (ni las borra ni las altera)', async () => {
    const manualId = await seedRow({
      concepto: cptoNinoAuto,
      ninoId: ninoSolo,
      origen: 'manual',
      importe: 1234,
    })
    const { data: antes } = await serviceClient
      .from('asignacion_concepto')
      .select('updated_at, importe_override_centimos, deleted_at')
      .eq('id', manualId)
      .single()

    const r = await cAdmin.rpc('reproponer_asignaciones', { p_centro_id: centro.id })
    expect(r.error).toBeNull()

    const { data: despues } = await serviceClient
      .from('asignacion_concepto')
      .select('updated_at, importe_override_centimos, deleted_at')
      .eq('id', manualId)
      .single()
    expect(despues!.deleted_at).toBeNull() // no borrada
    expect(despues!.importe_override_centimos).toBe(1234) // no alterada
    expect(despues!.updated_at).toBe(antes!.updated_at) // ni siquiera re-tocada
  })

  it('no duplica: varias autos soft-borradas del mismo par → 1 viva', async () => {
    await seedRow({ concepto: cptoNinoAuto, ninoId: ninoSolo, origen: 'automatico', borrada: true })
    await seedRow({ concepto: cptoNinoAuto, ninoId: ninoSolo, origen: 'automatico', borrada: true })

    const r = await cAdmin.rpc('reproponer_asignaciones', { p_centro_id: centro.id })
    expect(r.error).toBeNull()

    const rows = await vivas(cptoNinoAuto, ninoSolo)
    expect(rows).toHaveLength(1) // DISTINCT ON revive una sola
  })

  it('siembra las que faltan (destino sin fila alguna)', async () => {
    const r = await cAdmin.rpc('reproponer_asignaciones', { p_centro_id: centro.id })
    expect(r.error).toBeNull()

    const nino = await vivas(cptoNinoAuto)
    expect(nino.map((x) => x.id)).toHaveLength(3) // 3 niños matriculados
    const fam = await serviceClient
      .from('asignacion_concepto')
      .select('familia_id')
      .eq('concepto_id', cptoFamAuto)
      .is('deleted_at', null)
    expect((fam.data ?? []).map((x) => x.familia_id).sort()).toEqual(
      [familiaSolo, familiaDoble].sort()
    )
  })

  it('siembra una auto en un destino cuyo único rastro es una MANUAL soft-borrada', async () => {
    await seedRow({ concepto: cptoNinoAuto, ninoId: ninoSolo, origen: 'manual', borrada: true })
    const r = await cAdmin.rpc('reproponer_asignaciones', { p_centro_id: centro.id })
    expect(r.error).toBeNull()

    const rows = await vivas(cptoNinoAuto, ninoSolo)
    expect(rows).toHaveLength(1)
    expect(rows[0].origen).toBe('automatico') // se sembró una auto nueva
  })

  it('respeta ámbito/umbral: descuento signo=-1 solo familias ≥2 hijos (siembra y revive)', async () => {
    // Revive respeta el umbral: una auto de descuento soft-borrada de la familia con 1 hijo NO revive.
    const descSolo = await seedRow({
      concepto: cptoDescuento,
      familiaId: familiaSolo,
      origen: 'automatico',
      borrada: true,
    })

    const r = await cAdmin.rpc('reproponer_asignaciones', { p_centro_id: centro.id })
    expect(r.error).toBeNull()

    const desc = await serviceClient
      .from('asignacion_concepto')
      .select('familia_id')
      .eq('concepto_id', cptoDescuento)
      .is('deleted_at', null)
    expect((desc.data ?? []).map((x) => x.familia_id)).toEqual([familiaDoble]) // solo la de 2 hijos

    const { data: solo } = await serviceClient
      .from('asignacion_concepto')
      .select('deleted_at')
      .eq('id', descSolo)
      .single()
    expect(solo!.deleted_at).not.toBeNull() // no revivida (1 hijo no cumple el umbral)
  })

  it('devuelve { revividas, sembradas }', async () => {
    // Estado sembrado completo, luego borra 1 auto → reproponer revive esa 1, siembra 0.
    await cAdmin.rpc('proponer_asignaciones', { p_centro_id: centro.id })
    const target = (await vivas(cptoNinoAuto, ninoSolo))[0]
    await serviceClient
      .from('asignacion_concepto')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', target.id)

    const r = await cAdmin.rpc('reproponer_asignaciones', { p_centro_id: centro.id })
    expect(r.error).toBeNull()
    const res = r.data as { revividas: number; sembradas: number }
    expect(res.revividas).toBe(1)
    expect(res.sembradas).toBe(0)
  })

  it('regresión: el "Proponer" normal (proponer_asignaciones) sigue SIN revivir', async () => {
    const id = await seedRow({
      concepto: cptoNinoAuto,
      ninoId: ninoSolo,
      origen: 'automatico',
      borrada: true,
    })
    const r = await cAdmin.rpc('proponer_asignaciones', { p_centro_id: centro.id })
    expect(r.error).toBeNull()

    const { data: auto } = await serviceClient
      .from('asignacion_concepto')
      .select('deleted_at')
      .eq('id', id)
      .single()
    expect(auto!.deleted_at).not.toBeNull() // proponer NO resucita
    expect(await vivas(cptoNinoAuto, ninoSolo)).toHaveLength(0)
  })
})
