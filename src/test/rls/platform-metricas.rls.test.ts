import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Constants, type Database } from '@/types/database'

import {
  anonClient,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestAula,
  type TestUser,
} from './setup'

/**
 * Fase 5, PR 1 — `platform_metricas()`, las métricas del panel de plataforma (20261103120000).
 *
 * Lección de MisterFC (BC-8): un contador que incluye bajas, archivados o retirados miente. El
 * centro T siembra, junto a lo activo, una fila en cada estado NO activo, y los estados salen del
 * catálogo de los enums (`Constants`): un motivo de borrado o un estado de matrícula nuevo entra
 * solo en el test. Ninguno puede contar. Los centros U, W y V prueban las alertas, y uno borrado no
 * sale. Solo el superusuario la llama: ni la admin, ni una directora, ni una profe, ni anon.
 */

type Cliente = SupabaseClient<Database>
type Fila = Database['public']['Functions']['platform_metricas']['Returns'][number]

const MOTIVOS = Constants.public.Enums.motivo_borrado
const ESTADOS_MATRICULA = Constants.public.Enums.matricula_estado

const DIA = 86_400_000
const hace = (dias: number) => new Date(Date.now() - dias * DIA).toISOString()
const dentroDe = (dias: number) => new Date(Date.now() + dias * DIA).toISOString()
const email = () => `pm-${Math.random().toString(36).slice(2, 10)}@nido.test`

describe('platform_metricas: solo cuenta lo activo, y solo la ve la plataforma', () => {
  const usuarios: TestUser[] = []
  const centros: string[] = []
  let superU: TestUser
  let adminT: TestUser
  let directoraT: TestUser
  let profe1: TestUser
  let T: { id: string }
  let U: { id: string }
  let W: { id: string }
  let V: { id: string }
  let D: { id: string }
  let cSuper: Cliente
  let filas: Fila[]

  async function usuario(nombre: string) {
    const u = await createTestUser({ nombre })
    usuarios.push(u)
    return u
  }
  async function centro(nombre: string) {
    const c = await createTestCentro(nombre)
    centros.push(c.id)
    return c
  }
  /** Una fila de rol retirada, con su motivo y su fecha. */
  async function rolRetirado(
    u: string,
    c: string,
    rol: 'profe' | 'directora',
    motivo: string,
    cuando: string
  ) {
    const { error } = await serviceClient.from('roles_usuario').insert({
      usuario_id: u,
      centro_id: c,
      rol,
      deleted_at: cuando,
      deleted_reason: motivo as (typeof MOTIVOS)[number],
    })
    if (error) throw new Error(`rol retirado ${rol}/${motivo}: ${error.message}`)
  }
  async function matricula(
    ninoId: string,
    aula: TestAula,
    estado: (typeof ESTADOS_MATRICULA)[number],
    extra: { fecha_baja?: string; deleted_at?: string } = {}
  ) {
    const { error } = await serviceClient.from('matriculas').insert({
      nino_id: ninoId,
      aula_id: aula.id,
      curso_academico_id: aula.curso_academico_id,
      fecha_alta: '2026-09-01',
      estado,
      ...extra,
    })
    if (error) throw new Error(`matrícula ${estado}: ${error.message}`)
  }
  async function invitacion(c: string, rol: 'admin' | 'directora', extra: Record<string, unknown>) {
    const { error } = await serviceClient
      .from('invitaciones')
      .insert({ email: email(), centro_id: c, rol_objetivo: rol, ...extra } as never)
    if (error) throw new Error(`invitación ${rol}: ${error.message}`)
  }

  beforeAll(async () => {
    superU = await usuario('Superusuario Metricas')
    const { error: errSuper } = await serviceClient
      .from('platform_admins')
      .insert({ usuario_id: superU.id })
    if (errSuper) throw new Error(`sembrar superusuario falló: ${errSuper.message}`)

    // ---- Centro T: lo activo, y al lado una fila en cada estado no activo ----
    T = await centro('Metricas T')
    const cursoT = await createTestCurso(T.id, 'activo')
    const cursoPlanT = await createTestCurso(T.id, 'planificado')
    const aulaT = await createTestAula(T.id, cursoT.id, 'Aula viva T')
    const aulaBorrada = await createTestAula(T.id, cursoT.id, 'Aula borrada T')
    await serviceClient
      .from('aulas')
      .update({ deleted_at: hace(1) })
      .eq('id', aulaBorrada.id)
    const aulaPlan = await createTestAula(T.id, cursoPlanT.id, 'Aula del curso que viene T')

    // Personas: Dirección (admin + directora) y dos profes vivas.
    adminT = await usuario('Admin Metricas T')
    directoraT = await usuario('Directora Metricas T')
    profe1 = await usuario('Profe 1 Metricas T')
    const profe2 = await usuario('Profe 2 Metricas T')
    await asignarRol(adminT.id, T.id, 'admin')
    await asignarRol(directoraT.id, T.id, 'directora')
    await asignarRol(profe1.id, T.id, 'profe')
    await asignarRol(profe2.id, T.id, 'profe')
    // La profe 2 estuvo de baja temporal y volvió: cuenta como personal, no como de baja.
    await rolRetirado(profe2.id, T.id, 'profe', 'baja_temporal', hace(30))

    // Una persona por cada motivo de borrado del catálogo, con su fila profe y su fila directora
    // retiradas. Solo la de `baja_temporal` cuenta, y como «de baja temporal».
    for (const m of MOTIVOS) {
      const u = await usuario(`Retirada ${m}`)
      await rolRetirado(u.id, T.id, 'profe', m, hace(5))
      await rolRetirado(u.id, T.id, 'directora', m, hace(5))
    }
    // Manda la ÚLTIMA retirada: salida y después baja temporal → de baja; al revés → no.
    const salidaLuegoBaja = await usuario('Salida luego baja')
    await rolRetirado(salidaLuegoBaja.id, T.id, 'profe', 'salida_centro', hace(10))
    await rolRetirado(salidaLuegoBaja.id, T.id, 'profe', 'baja_temporal', hace(2))
    const bajaLuegoSalida = await usuario('Baja luego salida')
    await rolRetirado(bajaLuegoSalida.id, T.id, 'profe', 'baja_temporal', hace(10))
    await rolRetirado(bajaLuegoSalida.id, T.id, 'profe', 'salida_centro', hace(2))

    // Niños. F1: dos hermanos matriculados (una familia). F2: borrada, con su niño matriculado.
    // F3: solo niños en alta. Un niño por cada estado de matrícula del catálogo, en F3 salvo el
    // `activa`, que es el primero de F1.
    const ninoF1a = await createTestNino(T.id, 'Hermano A')
    const ninoF1b = await createTestNino(T.id, 'Hermano B')
    await serviceClient
      .from('ninos')
      .update({ familia_id: ninoF1a.familia_id })
      .eq('id', ninoF1b.id)
    const ninoF2 = await createTestNino(T.id, 'Nino familia borrada')
    await serviceClient
      .from('familias')
      .update({ deleted_at: hace(1), deleted_reason: 'revocacion_familia' })
      .eq('id', ninoF2.familia_id)
    const familiaF3 = (await createTestNino(T.id, 'Ancla F3')).familia_id
    for (const e of ESTADOS_MATRICULA) {
      if (e === 'activa') {
        await matricula(ninoF1a.id, aulaT, 'activa')
        continue
      }
      const n = await createTestNino(T.id, `Nino ${e}`)
      await serviceClient.from('ninos').update({ familia_id: familiaF3 }).eq('id', n.id)
      await matricula(n.id, aulaT, e, e === 'baja' ? { fecha_baja: '2026-10-01' } : {})
    }
    await matricula(ninoF1b.id, aulaT, 'activa')
    await matricula(ninoF2.id, aulaT, 'activa')
    // Activas que no cuentan: con fecha de baja, borrada, del curso que viene, de un niño borrado.
    const conBaja = await createTestNino(T.id, 'Activa con baja')
    await matricula(conBaja.id, aulaT, 'activa', { fecha_baja: '2026-10-01' })
    const borrada = await createTestNino(T.id, 'Activa borrada')
    await matricula(borrada.id, aulaT, 'activa', { deleted_at: hace(1) })
    const delQueViene = await createTestNino(T.id, 'Activa curso que viene')
    await matricula(delQueViene.id, aulaPlan, 'activa')
    const ninoBorrado = await createTestNino(T.id, 'Nino borrado')
    await matricula(ninoBorrado.id, aulaT, 'activa')
    await serviceClient
      .from('ninos')
      .update({ deleted_at: hace(1), deleted_reason: 'baja_nino' })
      .eq('id', ninoBorrado.id)

    // Invitaciones: una pendiente; aceptada, rechazada y caducada no cuentan.
    await invitacion(T.id, 'directora', { expires_at: dentroDe(7) })
    await invitacion(T.id, 'directora', { expires_at: dentroDe(7), accepted_at: hace(1) })
    await invitacion(T.id, 'directora', { expires_at: dentroDe(7), rejected_at: hace(1) })
    await invitacion(T.id, 'directora', { expires_at: hace(1) })

    // ---- U: sin admin, con una invitación de admin pendiente (y otra caducada, más vieja) ----
    U = await centro('Metricas U')
    await createTestCurso(U.id, 'activo')
    await invitacion(U.id, 'admin', { expires_at: hace(1), created_at: hace(20) })
    await invitacion(U.id, 'admin', { expires_at: dentroDe(7), created_at: hace(1) })
    // ---- W: sin admin, con la invitación de admin caducada ----
    W = await centro('Metricas W')
    await createTestCurso(W.id, 'activo')
    await invitacion(W.id, 'admin', { expires_at: hace(1) })
    // ---- V: con admin, sin curso activo; su invitación de admin no es alerta ----
    V = await centro('Metricas V')
    await createTestCurso(V.id, 'planificado')
    await asignarRol((await usuario('Admin Metricas V')).id, V.id, 'admin')
    await invitacion(V.id, 'admin', { expires_at: dentroDe(7) })
    // ---- D: centro borrado ----
    D = await centro('Metricas D borrado')
    await serviceClient
      .from('centros')
      .update({ deleted_at: hace(1) })
      .eq('id', D.id)

    cSuper = await clientFor(superU)
    const { data, error } = await cSuper.rpc('platform_metricas')
    if (error) throw new Error(`platform_metricas falló: ${error.message}`)
    filas = (data ?? []).filter((f) => centros.includes(f.centro_id))
  }, 240_000)

  afterAll(async () => {
    for (const c of centros) await deleteTestCentro(c)
    for (const u of usuarios) await deleteTestUser(u.id)
  }, 240_000)

  const de = (c: { id: string }) => filas.find((f) => f.centro_id === c.id)

  it('premisa: hay una fila retirada por cada motivo y una matrícula por cada estado, y existen', async () => {
    const { data: retiradas } = await serviceClient
      .from('roles_usuario')
      .select('deleted_reason, rol')
      .eq('centro_id', T.id)
      .not('deleted_at', 'is', null)
    for (const m of MOTIVOS) {
      expect(
        retiradas?.filter((r) => r.deleted_reason === m && r.rol === 'directora')
      ).toHaveLength(1)
    }
    const { data: mats } = await serviceClient
      .from('matriculas')
      .select('estado, nino:ninos!inner(centro_id)')
      .eq('nino.centro_id', T.id)
    for (const e of ESTADOS_MATRICULA) {
      expect(mats?.some((m) => m.estado === e)).toBe(true)
    }
    // Con todo lo no activo, las filas superan con mucho a lo que debe contar.
    expect(retiradas!.length).toBeGreaterThan(2 * MOTIVOS.length)
    expect(mats!.length).toBeGreaterThan(5)
  })

  it('el centro T: cada recuento cuenta solo lo activo', () => {
    expect(de(T)).toEqual(
      expect.objectContaining({
        ninos_matriculados: 3, // los dos hermanos y el de la familia borrada
        ninos_en_alta: 2, // pendiente y lista
        familias: 1, // la de los hermanos: la borrada y la de solo altas no
        personal: 2,
        personal_baja_temporal: 2, // la del motivo baja_temporal y «salida luego baja»
        direccion: 2, // la admin y la directora vivas
        aulas: 1,
        invitaciones_pendientes: 1,
        sin_admin: false,
        sin_curso_activo: false,
        invitacion_admin: null,
      })
    )
    expect(de(T)?.curso_activo).toMatch(/^Curso-/)
  })

  it('las alertas: sin admin con invitación pendiente o caducada, y sin curso activo', () => {
    expect(de(U)).toEqual(
      expect.objectContaining({ sin_admin: true, invitacion_admin: 'pendiente' })
    )
    expect(de(W)).toEqual(
      expect.objectContaining({ sin_admin: true, invitacion_admin: 'caducada' })
    )
    expect(de(V)).toEqual(
      expect.objectContaining({
        sin_admin: false,
        invitacion_admin: null, // con admin viva no es alerta
        sin_curso_activo: true,
        curso_activo: null,
        ninos_matriculados: 0,
        aulas: 0,
      })
    )
  })

  it('un centro borrado no sale', () => {
    expect(de(D)).toBeUndefined()
    expect(filas).toHaveLength(4)
  })

  it('solo la plataforma: la admin, una directora, una profe y anon reciben 42501', async () => {
    // Premisa: el superusuario sí la llama (las filas de arriba vienen de su sesión).
    expect(filas.length).toBeGreaterThan(0)
    for (const u of [adminT, directoraT, profe1]) {
      const c = await clientFor(u)
      const { data, error } = await c.rpc('platform_metricas')
      expect(error?.code).toBe('42501')
      expect(data).toBeNull()
    }
    const { error: errAnon } = await anonClient().rpc('platform_metricas')
    expect(errAnon?.code).toBe('42501')
  })
})
