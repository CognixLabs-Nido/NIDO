import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  anonClient,
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Las lecturas por función del autorizado, primera de dos (`20270115120000`, 2026-11-11). Solo
 * AÑADE tres funciones que la app nueva llama; la segunda (`20270115130000`) es la que cierra la
 * tabla. Aquí: quién recibe qué de cada función. (Lo que la primera, sola, no cerraba lo afirmaba
 * un test que la segunda vuelve falso: se quitó con ella; lo que cierra la segunda lo mide
 * `autorizado-lee-solo-lo-suyo.rls.test.ts`.)
 */
const MARCAS = { notas_admin: 'MARCA-NA', dni: '12345678Z', observaciones_familia: 'MARCA-OB' }

describe('las lecturas por función (primera de dos)', () => {
  let centro: { id: string }
  let nino: { id: string; familia_id: string }
  let legal: TestUser
  let autorizado: TestUser
  let profe: TestUser
  let admin: TestUser
  let ajeno: TestUser
  let firmaLegal: string
  const usuarios: string[] = []
  const sesiones = new Map<string, SupabaseClient<Database>>()
  const como = async (u: TestUser) => {
    if (!sesiones.has(u.id)) sesiones.set(u.id, await clientFor(u))
    return sesiones.get(u.id)!
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Lecturas Por Funcion')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Lecturas Por Funcion')
    await matricular(nino.id, aula.id, curso.id)

    legal = await createTestUser({ nombre: 'Legal Lecturas Por Funcion' })
    autorizado = await createTestUser({ nombre: 'Autorizado Lecturas Por Funcion' })
    profe = await createTestUser({ nombre: 'Profe Lecturas Por Funcion' })
    admin = await createTestUser({ nombre: 'Admin Lecturas Por Funcion' })
    ajeno = await createTestUser({ nombre: 'Ajeno Lecturas Por Funcion' })
    usuarios.push(legal.id, autorizado.id, profe.id, admin.id, ajeno.id)
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarProfeAula(profe.id, aula.id, curso.id)
    await asignarRol(legal.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await asignarRol(ajeno.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(nino.familia_id, legal.id, 'titular')
    await crearVinculo(nino.id, legal.id, 'tutor_legal_principal', {
      puede_firmar_autorizaciones: true,
    })
    await crearVinculo(nino.id, autorizado.id, 'autorizado', {})

    const n = await serviceClient.from('ninos').update(MARCAS).eq('id', nino.id)
    if (n.error) throw new Error(`marcas: ${n.error.message}`)

    const pl = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'recogida',
        es_plantilla: true,
        titulo: 'Recogida (plantilla)',
        texto: 'Texto',
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    if (pl.error || !pl.data) throw new Error(`plantilla: ${pl.error?.message}`)
    const inst = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'recogida',
        es_plantilla: false,
        ambito: 'nino',
        nino_id: nino.id,
        plantilla_id: pl.data.id,
        titulo: 'Recogida test',
        texto: 'Texto',
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: legal.id,
      })
      .select('id')
      .single()
    if (inst.error || !inst.data) throw new Error(`instancia: ${inst.error?.message}`)
    const f = await serviceClient
      .from('firmas_autorizacion')
      .insert({
        autorizacion_id: inst.data.id,
        nino_id: nino.id,
        firmante_id: legal.id,
        rol_firmante: 'tutor_legal_principal',
        decision: 'firmado',
        texto_hash: 'a'.repeat(64),
        texto_version: 'v1',
        nombre_tecleado: 'Legal Lecturas Por Funcion',
        firma_imagen: 'MARCA-TRAZO',
        ip_address: '10.9.8.7',
        user_agent: 'MARCA-UA',
        datos: { personas: [{ nombre: 'Persona Demo', dni: '87654321X', parentesco: 'abuela' }] },
      })
      .select('id')
      .single()
    if (f.error || !f.data) throw new Error(`firma: ${f.error?.message}`)
    firmaLegal = f.data.id
  })

  afterAll(async () => {
    for (const u of usuarios) await deleteTestUser(u)
  })

  it('premisas: quién es quién con el niño, y las marcas puestas', async () => {
    const { data: v } = await serviceClient
      .from('vinculos_familiares')
      .select('usuario_id, tipo_vinculo')
      .eq('nino_id', nino.id)
      .is('deleted_at', null)
    const tipo = new Map((v ?? []).map((x) => [x.usuario_id, x.tipo_vinculo]))
    expect(tipo.get(legal.id)).toBe('tutor_legal_principal')
    expect(tipo.get(autorizado.id)).toBe('autorizado')
    expect(tipo.has(profe.id)).toBe(false)
    expect(tipo.has(ajeno.id)).toBe(false)
    const { data: esProfe } = await (
      await como(profe)
    ).rpc('es_profe_de_nino', {
      p_nino_id: nino.id,
    })
    expect(esProfe).toBe(true)
  })

  it('ficha_gestion_ninos: a la Dirección y al tutor legal; ni la profe, ni el autorizado, ni otro', async () => {
    for (const u of [legal, admin]) {
      const { data, error } = await (
        await como(u)
      ).rpc('ficha_gestion_ninos', {
        p_nino_ids: [nino.id],
      })
      expect.soft(error, u.id).toBeNull()
      expect.soft(data, u.id).toEqual([expect.objectContaining({ nino_id: nino.id, ...MARCAS })])
    }
    for (const u of [profe, autorizado, ajeno]) {
      const { data, error } = await (
        await como(u)
      ).rpc('ficha_gestion_ninos', {
        p_nino_ids: [nino.id],
      })
      // La fila que no le toca no viene, sin error: así se distingue «no le toca» de «falló».
      expect.soft(error, u.id).toBeNull()
      expect.soft(data, u.id).toEqual([])
    }
  })

  it('contenido_firmas: a quien firmó, a la profe y a la Dirección; ni al autorizado ni a otro', async () => {
    for (const u of [legal, profe, admin]) {
      const { data, error } = await (
        await como(u)
      ).rpc('contenido_firmas', {
        p_firma_ids: [firmaLegal],
      })
      expect.soft(error, u.id).toBeNull()
      expect
        .soft(data, u.id)
        .toEqual([expect.objectContaining({ firma_id: firmaLegal, firma_imagen: 'MARCA-TRAZO' })])
    }
    for (const u of [autorizado, ajeno]) {
      const { data, error } = await (
        await como(u)
      ).rpc('contenido_firmas', {
        p_firma_ids: [firmaLegal],
      })
      expect.soft(error, u.id).toBeNull()
      expect.soft(data, u.id).toEqual([])
    }
  })

  it('puede_exportar_nino: la Dirección, la profe del niño y el tutor legal; el autorizado y otro, no', async () => {
    const quien: [TestUser, boolean][] = [
      [admin, true],
      [profe, true],
      [legal, true],
      [autorizado, false],
      [ajeno, false],
    ]
    for (const [u, esperado] of quien) {
      const { data, error } = await (
        await como(u)
      ).rpc('puede_exportar_nino', {
        p_nino_id: nino.id,
      })
      expect.soft(error, u.id).toBeNull()
      expect.soft(data, u.id).toBe(esperado)
    }
  })

  it('sin sesión no se ejecutan', async () => {
    const anon = anonClient()
    const r = await Promise.all([
      anon.rpc('ficha_gestion_ninos', { p_nino_ids: [nino.id] }),
      anon.rpc('contenido_firmas', { p_firma_ids: [firmaLegal] }),
      anon.rpc('puede_exportar_nino', { p_nino_id: nino.id }),
    ])
    for (const { data, error } of r) {
      expect.soft(error?.code).toBe('42501')
      expect.soft(data).toBeNull()
    }
  })
})
