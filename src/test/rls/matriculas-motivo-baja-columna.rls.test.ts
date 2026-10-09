import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  anonClient,
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * 20261009120000 — `matriculas.motivo_baja` solo para Dirección (permiso por COLUMNA) +
 * recorrido reducido de la familia.
 *
 *  1. Con sesión nadie lee `motivo_baja` por la API (tutor, profe, ni admin) → 42501; ni
 *     `select=*`. Las demás columnas se siguen leyendo con las mismas policies de filas.
 *  2. Las lecturas de familia que hace la app (gate del alta, `altaValidada`, asistente,
 *     mensajería, eventos/autorizaciones de aula) siguen funcionando con sus columnas.
 *  3. `get_motivos_baja_matriculas`: admin del centro → motivo; admin de otro centro, profe
 *     o tutor → 42501.
 *  4. `get_recorrido_nino_familia`: tutor legal → solo `activa`/`baja`, sin motivo;
 *     autorizado, profe o anon → error.
 *
 * Gate: MATRICULAS_MOTIVO_COLUMNA_APPLIED=1
 */

const APPLIED = process.env.MATRICULAS_MOTIVO_COLUMNA_APPLIED === '1'

const MOTIVO = 'nota interna de dirección'

describe.skipIf(!APPLIED)('matriculas.motivo_baja por columna + recorrido familia', () => {
  let admin: TestUser
  let adminOtro: TestUser
  let tutor: TestUser
  let autorizado: TestUser
  let profe: TestUser
  let cAdmin: SupabaseClient<Database>
  let cAdminOtro: SupabaseClient<Database>
  let cTutor: SupabaseClient<Database>
  let cAutorizado: SupabaseClient<Database>
  let cProfe: SupabaseClient<Database>
  const centros: string[] = []
  const usuarios: string[] = []
  let ninoId = ''
  let aulaId = ''
  let matriculaBajaId = ''

  beforeAll(async () => {
    admin = await createTestUser({ nombre: 'Admin Motivo' })
    adminOtro = await createTestUser({ nombre: 'Admin Otro Centro' })
    tutor = await createTestUser({ nombre: 'Tutor Motivo' })
    autorizado = await createTestUser({ nombre: 'Autorizado Motivo' })
    profe = await createTestUser({ nombre: 'Profe Motivo' })
    usuarios.push(admin.id, adminOtro.id, tutor.id, autorizado.id, profe.id)

    const centro = await createTestCentro('Centro Motivo')
    const otro = await createTestCentro('Centro Otro')
    centros.push(centro.id, otro.id)
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(adminOtro.id, otro.id, 'admin')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await asignarRol(profe.id, centro.id, 'profe')

    // Tres cursos: uno pasado (baja con motivo), el activo (activa) y el siguiente
    // (pendiente, como la que crea el pase de curso).
    const cursos: string[] = []
    for (const [nombre, inicio, fin, estado] of [
      ['Pasado', '2025-09-01', '2026-07-31', 'cerrado'],
      ['Activo', '2026-09-01', '2027-07-31', 'activo'],
      ['Siguiente', '2027-09-01', '2028-07-31', 'planificado'],
    ] as const) {
      const { data, error } = await serviceClient
        .from('cursos_academicos')
        .insert({ centro_id: centro.id, nombre, fecha_inicio: inicio, fecha_fin: fin, estado })
        .select('id')
        .single()
      if (error || !data) throw new Error(`curso ${nombre}: ${error?.message}`)
      cursos.push(data.id)
    }
    const [cursoPasado, cursoActivo, cursoSiguiente] = cursos as [string, string, string]

    const { data: aula, error: aulaErr } = await serviceClient
      .from('aulas')
      .insert({ centro_id: centro.id, nombre: 'Aula Motivo' })
      .select('id')
      .single()
    if (aulaErr || !aula) throw new Error(`aula: ${aulaErr?.message}`)
    aulaId = aula.id
    for (const curso of cursos) {
      const { error } = await serviceClient.from('aulas_curso').insert({
        centro_id: centro.id,
        aula_id: aulaId,
        curso_academico_id: curso,
        tramo_edad: [2024],
        capacidad: 12,
      })
      if (error) throw new Error(`aulas_curso: ${error.message}`)
    }

    const nino = await createTestNino(centro.id, 'Niño Motivo')
    ninoId = nino.id
    await crearVinculo(ninoId, tutor.id, 'tutor_legal_principal', { puede_recibir_mensajes: true })
    await crearVinculo(ninoId, autorizado.id, 'autorizado', { puede_recibir_mensajes: true })
    await asignarProfeAula(profe.id, aulaId, cursoActivo)

    const { data: mats, error: matErr } = await serviceClient
      .from('matriculas')
      .insert([
        {
          nino_id: ninoId,
          aula_id: aulaId,
          curso_academico_id: cursoPasado,
          fecha_alta: '2025-09-01',
          fecha_baja: '2026-07-31',
          estado: 'baja',
          motivo_baja: MOTIVO,
        },
        {
          nino_id: ninoId,
          aula_id: aulaId,
          curso_academico_id: cursoActivo,
          fecha_alta: '2026-09-01',
          estado: 'activa',
          motivo_baja: MOTIVO,
        },
        {
          nino_id: ninoId,
          aula_id: aulaId,
          curso_academico_id: cursoSiguiente,
          fecha_alta: '2027-09-01',
          estado: 'pendiente',
        },
      ])
      .select('id, estado')
    if (matErr || !mats) throw new Error(`matriculas: ${matErr?.message}`)
    matriculaBajaId = mats.find((m) => m.estado === 'baja')!.id

    cAdmin = await clientFor(admin)
    cAdminOtro = await clientFor(adminOtro)
    cTutor = await clientFor(tutor)
    cAutorizado = await clientFor(autorizado)
    cProfe = await clientFor(profe)
  }, 120_000)

  afterAll(async () => {
    for (const id of centros) await deleteTestCentro(id)
    for (const id of usuarios) await deleteTestUser(id)
  }, 120_000)

  describe('nadie lee motivo_baja por la API', () => {
    it.each([
      ['tutor legal', () => cTutor],
      ['profe del aula', () => cProfe],
      ['admin del centro', () => cAdmin],
    ])('%s → 42501', async (_rol, cliente) => {
      const { error } = await cliente()
        .from('matriculas')
        .select('motivo_baja')
        .eq('nino_id', ninoId)
      expect(error?.code).toBe('42501')
    })

    it('select=* tampoco pasa (42501)', async () => {
      const { error } = await cTutor.from('matriculas').select('*').eq('nino_id', ninoId)
      expect(error?.code).toBe('42501')
    })

    it('service role sí la lee (las RPC y el CI no cambian)', async () => {
      const { data, error } = await serviceClient
        .from('matriculas')
        .select('motivo_baja')
        .eq('id', matriculaBajaId)
        .single()
      expect(error).toBeNull()
      expect(data?.motivo_baja).toBe(MOTIVO)
    })
  })

  describe('las lecturas de familia de la app siguen funcionando', () => {
    it('gate del alta (gate-familia): nino_id, estado de las vigentes', async () => {
      const { data, error } = await cTutor
        .from('matriculas')
        .select('nino_id, estado')
        .in('nino_id', [ninoId])
        .is('fecha_baja', null)
        .is('deleted_at', null)
      expect(error).toBeNull()
      expect(data?.map((m) => m.estado).sort()).toEqual(['activa', 'pendiente'])
    })

    it('altaValidada (cambios-pendientes/gate): id de la activa', async () => {
      const { data, error } = await cTutor
        .from('matriculas')
        .select('id')
        .eq('nino_id', ninoId)
        .eq('estado', 'activa')
        .is('fecha_baja', null)
        .is('deleted_at', null)
        .limit(1)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })

    it('asistente de alta: estado de las vigentes, también el autorizado', async () => {
      for (const c of [cTutor, cAutorizado]) {
        const { data, error } = await c
          .from('matriculas')
          .select('estado')
          .eq('nino_id', ninoId)
          .is('fecha_baja', null)
          .is('deleted_at', null)
        expect(error).toBeNull()
        expect(data).toHaveLength(2)
      }
    })

    it('eventos y autorizaciones de aula: nino_id de las activas del aula', async () => {
      for (const c of [cTutor, cAutorizado]) {
        const { data, error } = await c
          .from('matriculas')
          .select('nino_id')
          .eq('aula_id', aulaId)
          .eq('estado', 'activa')
          .is('fecha_baja', null)
          .is('deleted_at', null)
        expect(error).toBeNull()
        expect(data?.map((m) => m.nino_id)).toEqual([ninoId])
      }
    })

    it('mensajería: embed de matriculas desde vinculos (tutor y autorizado)', async () => {
      for (const [c, usuarioId] of [
        [cTutor, tutor.id],
        [cAutorizado, autorizado.id],
      ] as const) {
        const { data, error } = await c
          .from('vinculos_familiares')
          .select(
            'permisos, nino:ninos!inner(id, matriculas(aula_id, fecha_baja, deleted_at, estado))'
          )
          .eq('usuario_id', usuarioId)
          .is('deleted_at', null)
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
      }
    })

    it('cabecera de la conversación: embed matriculas(aula_id, fecha_baja) desde ninos', async () => {
      const { data, error } = await cAutorizado
        .from('ninos')
        .select('nombre, matriculas(aula_id, fecha_baja)')
        .eq('id', ninoId)
        .single()
      expect(error).toBeNull()
      expect(data?.matriculas).toHaveLength(3)
    })

    it('profe: sus columnas de siempre en el curso activo', async () => {
      const { data, error } = await cProfe
        .from('matriculas')
        .select('id, nino_id, aula_id, estado, fecha_baja')
        .eq('aula_id', aulaId)
      expect(error).toBeNull()
      expect(data?.map((m) => m.estado)).toEqual(['activa'])
      expect(data?.[0]?.aula_id).toBe(aulaId)
    })
  })

  describe('get_motivos_baja_matriculas (Dirección)', () => {
    it('admin del centro → lee el motivo', async () => {
      const { data, error } = await cAdmin.rpc('get_motivos_baja_matriculas', {
        p_nino_ids: [ninoId],
      })
      expect(error).toBeNull()
      expect(data?.find((r) => r.matricula_id === matriculaBajaId)?.motivo_baja).toBe(MOTIVO)
    })

    it.each([
      ['admin de otro centro', () => cAdminOtro],
      ['profe', () => cProfe],
      ['tutor legal', () => cTutor],
    ])('%s → 42501', async (_rol, cliente) => {
      const { error } = await cliente().rpc('get_motivos_baja_matriculas', {
        p_nino_ids: [ninoId],
      })
      expect(error?.code).toBe('42501')
    })

    it('niño inexistente → 42501 (es_admin(NULL) no cuela)', async () => {
      const { error } = await cAdmin.rpc('get_motivos_baja_matriculas', {
        p_nino_ids: ['00000000-0000-4000-8000-000000000000'],
      })
      expect(error?.code).toBe('42501')
    })
  })

  describe('get_recorrido_nino_familia (familia)', () => {
    it('tutor legal → activa y baja, sin pendiente ni motivo', async () => {
      const { data, error } = await cTutor.rpc('get_recorrido_nino_familia', {
        p_nino_id: ninoId,
      })
      expect(error).toBeNull()
      expect(data?.map((r) => [r.curso_nombre, r.estado])).toEqual([
        ['Activo', 'activa'],
        ['Pasado', 'baja'],
      ])
      for (const fila of data ?? []) {
        expect(Object.keys(fila)).not.toContain('motivo_baja')
        expect(fila.aula_nombre).toBe('Aula Motivo')
      }
    })

    it.each([
      ['autorizado', () => cAutorizado],
      ['profe', () => cProfe],
      ['admin (no es tutor)', () => cAdmin],
    ])('%s → 42501', async (_rol, cliente) => {
      const { error } = await cliente().rpc('get_recorrido_nino_familia', { p_nino_id: ninoId })
      expect(error?.code).toBe('42501')
    })

    it('anon → sin permiso de ejecución', async () => {
      const { data, error } = await anonClient().rpc('get_recorrido_nino_familia', {
        p_nino_id: ninoId,
      })
      expect(error).not.toBeNull()
      expect(data).toBeNull()
    })
  })
})
