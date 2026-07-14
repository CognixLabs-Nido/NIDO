import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * F-4-2 — Asignación PERMANENTE de conceptos (asignacion_concepto + proponer_asignaciones).
 *
 * Verifica el esquema (XOR niño/familia, UNIQUE por destino, trigger centro_id), la RLS
 * (admin CRUD de su centro; otro admin no; tutor sin acceso) y la RPC de propuesta
 * automática (siembra por ámbito, regla de descuento hermanos ≥2 hijos, idempotencia y
 * no-resurrección de una auto soft-borrada).
 *
 * Gateado: F42_MIGRATION_APPLIED=1 (requiere phase_f42 aplicada en la BD de test).
 */

const APPLIED = process.env.F42_MIGRATION_APPLIED === '1'

// Inserta un niño con una familia CONCRETA (para familias con varios hijos).
async function insertarNino(centroId: string, familiaId: string, nombre: string): Promise<string> {
  const { data, error } = await serviceClient
    .from('ninos')
    .insert({
      centro_id: centroId,
      familia_id: familiaId,
      nombre,
      apellidos: 'Apellido Test',
      fecha_nacimiento: '2024-03-15',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`insertarNino falló: ${error?.message}`)
  return data.id
}

describe.skipIf(!APPLIED)('F-4-2 — asignación permanente (asignacion_concepto + proponer)', () => {
  // ── Esquema (XOR / UNIQUE / trigger centro_id) + RLS ───────────────────────
  describe('esquema y RLS', () => {
    let centroA: { id: string }
    let centroB: { id: string }
    let ninoA: Awaited<ReturnType<typeof createTestNino>>
    let familiaA: string
    let conceptoNino: string
    let conceptoFam: string
    let adminA: TestUser
    let adminB: TestUser
    let tutorA: TestUser
    let cAdminA: Awaited<ReturnType<typeof clientFor>>
    let cAdminB: Awaited<ReturnType<typeof clientFor>>
    let cTutorA: Awaited<ReturnType<typeof clientFor>>

    beforeAll(async () => {
      centroA = await createTestCentro('Centro F42 A')
      centroB = await createTestCentro('Centro F42 B')
      const curso = await createTestCurso(centroA.id)
      const aula = await createTestAula(centroA.id, curso.id)
      ninoA = await createTestNino(centroA.id, 'Nino F42 A')
      familiaA = ninoA.familia_id
      await matricular(ninoA.id, aula.id, curso.id)

      const cNino = await serviceClient
        .from('conceptos_cobro')
        .insert({
          centro_id: centroA.id,
          nombre: 'Cuota (niño)',
          tipo_concepto: 'mensual',
          tipo_valor: 'fijo',
          importe_centimos: 29000,
          ambito: 'nino',
        })
        .select('id')
        .single()
      conceptoNino = cNino.data!.id

      const cFam = await serviceClient
        .from('conceptos_cobro')
        .insert({
          centro_id: centroA.id,
          nombre: 'Cuota familia',
          tipo_concepto: 'mensual',
          tipo_valor: 'fijo',
          importe_centimos: 5000,
          ambito: 'familia',
        })
        .select('id')
        .single()
      conceptoFam = cFam.data!.id

      adminA = await createTestUser({ nombre: 'Admin F42 A' })
      await asignarRol(adminA.id, centroA.id, 'admin')
      cAdminA = await clientFor(adminA)

      adminB = await createTestUser({ nombre: 'Admin F42 B' })
      await asignarRol(adminB.id, centroB.id, 'admin')
      cAdminB = await clientFor(adminB)

      tutorA = await createTestUser({ nombre: 'Tutor F42 A' })
      await crearFamiliaTutor(familiaA, tutorA.id)
      cTutorA = await clientFor(tutorA)
    })

    afterAll(async () => {
      for (const c of [centroA.id, centroB.id]) {
        await serviceClient.from('asignacion_concepto').delete().eq('centro_id', c)
        await serviceClient.from('conceptos_cobro').delete().eq('centro_id', c)
      }
      await deleteTestCentro(centroA.id)
      await deleteTestCentro(centroB.id)
      await deleteTestUser(adminA.id)
      await deleteTestUser(adminB.id)
      await deleteTestUser(tutorA.id)
    })

    it('acepta asignación por NIÑO (XOR) y deriva centro_id del niño', async () => {
      const ins = await serviceClient
        .from('asignacion_concepto')
        .insert({ concepto_id: conceptoNino, nino_id: ninoA.id, origen: 'manual' })
        .select('id, centro_id')
        .single()
      expect(ins.error).toBeNull()
      expect(ins.data!.centro_id).toBe(centroA.id) // trigger derivó centro del niño
      await serviceClient.from('asignacion_concepto').delete().eq('id', ins.data!.id)
    })

    it('acepta asignación por FAMILIA (XOR) y deriva centro_id de la familia', async () => {
      const ins = await serviceClient
        .from('asignacion_concepto')
        .insert({ concepto_id: conceptoFam, familia_id: familiaA, origen: 'automatico' })
        .select('id, centro_id')
        .single()
      expect(ins.error).toBeNull()
      expect(ins.data!.centro_id).toBe(centroA.id) // trigger derivó centro de la familia
      await serviceClient.from('asignacion_concepto').delete().eq('id', ins.data!.id)
    })

    it('rechaza niño Y familia a la vez (CHECK XOR)', async () => {
      const ins = await serviceClient
        .from('asignacion_concepto')
        .insert({ concepto_id: conceptoNino, nino_id: ninoA.id, familia_id: familiaA, origen: 'manual' })
        .select('id')
      expect(ins.error).not.toBeNull()
    })

    it('rechaza duplicado vivo (concepto + destino) — UNIQUE parcial', async () => {
      const a = await serviceClient
        .from('asignacion_concepto')
        .insert({ concepto_id: conceptoNino, nino_id: ninoA.id, origen: 'manual' })
        .select('id')
        .single()
      expect(a.error).toBeNull()
      const b = await serviceClient
        .from('asignacion_concepto')
        .insert({ concepto_id: conceptoNino, nino_id: ninoA.id, origen: 'manual' })
        .select('id')
      expect(b.error?.code).toBe('23505')
      await serviceClient.from('asignacion_concepto').delete().eq('id', a.data!.id)
    })

    it('el admin del centro hace CRUD; el admin de otro centro NO', async () => {
      const ins = await cAdminA
        .from('asignacion_concepto')
        .insert({ centro_id: centroA.id, concepto_id: conceptoNino, nino_id: ninoA.id, origen: 'manual' })
        .select('id')
        .maybeSingle()
      expect(ins.error).toBeNull()
      const id = ins.data!.id

      const sel = await cAdminA.from('asignacion_concepto').select('id').eq('id', id)
      expect(sel.data ?? []).toHaveLength(1)

      const upd = await cAdminA
        .from('asignacion_concepto')
        .update({ importe_override_centimos: 1000 })
        .eq('id', id)
        .select('id')
      expect(upd.error).toBeNull()

      // admin de otro centro: ni lee ni escribe.
      const selB = await cAdminB.from('asignacion_concepto').select('id').eq('id', id)
      expect(selB.data ?? []).toHaveLength(0)
      const insB = await cAdminB
        .from('asignacion_concepto')
        .insert({ centro_id: centroA.id, concepto_id: conceptoNino, familia_id: familiaA, origen: 'manual' })
        .select('id')
        .maybeSingle()
      expect(insB.error).not.toBeNull()

      await serviceClient.from('asignacion_concepto').delete().eq('id', id)
    })

    it('el tutor NO puede leer ni escribir asignacion_concepto', async () => {
      const seed = await serviceClient
        .from('asignacion_concepto')
        .insert({ concepto_id: conceptoNino, nino_id: ninoA.id, origen: 'manual' })
        .select('id')
        .single()
      expect(seed.error).toBeNull()

      const read = await cTutorA.from('asignacion_concepto').select('id').eq('nino_id', ninoA.id)
      expect(read.data ?? []).toHaveLength(0)

      const write = await cTutorA
        .from('asignacion_concepto')
        .insert({ centro_id: centroA.id, concepto_id: conceptoFam, familia_id: familiaA, origen: 'manual' })
        .select('id')
        .maybeSingle()
      expect(write.error).not.toBeNull()

      await serviceClient.from('asignacion_concepto').delete().eq('id', seed.data!.id)
    })
  })

  // ── proponer_asignaciones (propuesta automática) ───────────────────────────
  describe('proponer_asignaciones', () => {
    let centro: { id: string }
    let familiaSolo: string
    let ninoSolo: string
    let familiaDoble: string
    let ninoD1: string
    let ninoD2: string
    let cptoNinoAuto: string
    let cptoFamAuto: string
    let cptoDescuento: string
    let cptoManual: string
    let admin: TestUser
    let cAdmin: Awaited<ReturnType<typeof clientFor>>

    beforeAll(async () => {
      centro = await createTestCentro('Centro F42 propuesta')
      const curso = await createTestCurso(centro.id)
      const aula = await createTestAula(centro.id, curso.id)

      // Familia con 1 hijo matriculado.
      familiaSolo = await createTestFamilia(centro.id)
      ninoSolo = await insertarNino(centro.id, familiaSolo, 'Solo')
      await matricular(ninoSolo, aula.id, curso.id)

      // Familia con 2 hijos matriculados.
      familiaDoble = await createTestFamilia(centro.id)
      ninoD1 = await insertarNino(centro.id, familiaDoble, 'Doble 1')
      ninoD2 = await insertarNino(centro.id, familiaDoble, 'Doble 2')
      await matricular(ninoD1, aula.id, curso.id)
      await matricular(ninoD2, aula.id, curso.id)

      const mk = async (row: {
        nombre: string
        ambito: 'nino' | 'familia'
        aplicacion: 'automatico' | 'manual'
        signo?: number
      }) => {
        const r = await serviceClient
          .from('conceptos_cobro')
          .insert({
            centro_id: centro.id,
            nombre: row.nombre,
            tipo_concepto: 'mensual',
            tipo_valor: 'fijo',
            importe_centimos: 10000,
            ambito: row.ambito,
            aplicacion: row.aplicacion,
            signo: row.signo ?? 1,
          })
          .select('id')
          .single()
        if (r.error || !r.data) throw new Error(`concepto ${row.nombre}: ${r.error?.message}`)
        return r.data.id
      }

      cptoNinoAuto = await mk({ nombre: 'Cuota niño auto', ambito: 'nino', aplicacion: 'automatico' })
      cptoFamAuto = await mk({ nombre: 'Cuota familia auto', ambito: 'familia', aplicacion: 'automatico' })
      cptoDescuento = await mk({
        nombre: 'Descuento hermanos',
        ambito: 'familia',
        aplicacion: 'automatico',
        signo: -1,
      })
      cptoManual = await mk({ nombre: 'Extra manual', ambito: 'nino', aplicacion: 'manual' })

      admin = await createTestUser({ nombre: 'Admin F42 propuesta' })
      await asignarRol(admin.id, centro.id, 'admin')
      cAdmin = await clientFor(admin)
    })

    afterAll(async () => {
      await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
      await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
      await deleteTestCentro(centro.id)
      await deleteTestUser(admin.id)
    })

    it('siembra por ámbito, aplica la regla de hermanos, es idempotente, ignora manual y no resucita soft-borradas', async () => {
      const r1 = await cAdmin.rpc('proponer_asignaciones', { p_centro_id: centro.id })
      expect(r1.error).toBeNull()

      // Concepto NIÑO automático → a los 3 niños matriculados.
      const ninoRows = await serviceClient
        .from('asignacion_concepto')
        .select('id, nino_id')
        .eq('concepto_id', cptoNinoAuto)
        .is('deleted_at', null)
      expect((ninoRows.data ?? []).map((r) => r.nino_id).sort()).toEqual(
        [ninoSolo, ninoD1, ninoD2].sort()
      )

      // Concepto FAMILIA automático (cobro) → a ambas familias (≥1 hijo).
      const famRows = await serviceClient
        .from('asignacion_concepto')
        .select('familia_id')
        .eq('concepto_id', cptoFamAuto)
        .is('deleted_at', null)
      expect((famRows.data ?? []).map((r) => r.familia_id).sort()).toEqual(
        [familiaSolo, familiaDoble].sort()
      )

      // Descuento (signo=-1) → SOLO la familia con ≥2 hijos.
      const descRows = await serviceClient
        .from('asignacion_concepto')
        .select('familia_id')
        .eq('concepto_id', cptoDescuento)
        .is('deleted_at', null)
      expect((descRows.data ?? []).map((r) => r.familia_id)).toEqual([familiaDoble])

      // Concepto manual → NO se siembra.
      const manRows = await serviceClient
        .from('asignacion_concepto')
        .select('id')
        .eq('concepto_id', cptoManual)
      expect(manRows.data ?? []).toHaveLength(0)

      // Idempotente: 2ª llamada no duplica.
      const r2 = await cAdmin.rpc('proponer_asignaciones', { p_centro_id: centro.id })
      expect(r2.error).toBeNull()
      const ninoRows2 = await serviceClient
        .from('asignacion_concepto')
        .select('id')
        .eq('concepto_id', cptoNinoAuto)
        .is('deleted_at', null)
      expect(ninoRows2.data ?? []).toHaveLength(3)

      // No resucita una auto soft-borrada por la directora.
      const target = (ninoRows.data ?? []).find((r) => r.nino_id === ninoSolo)!
      await serviceClient
        .from('asignacion_concepto')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', target.id)
      const r3 = await cAdmin.rpc('proponer_asignaciones', { p_centro_id: centro.id })
      expect(r3.error).toBeNull()
      const afterKill = await serviceClient
        .from('asignacion_concepto')
        .select('id')
        .eq('concepto_id', cptoNinoAuto)
        .eq('nino_id', ninoSolo)
        .is('deleted_at', null)
      expect(afterKill.data ?? []).toHaveLength(0)
    })
  })
})
