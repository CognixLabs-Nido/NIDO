import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/db'

import { borrarDocumentosDe, creaDocumento, subeVersion } from './documentos-centro-fixture'
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
 * El contenido de las firmas de los documentos del centro, por función (`20270125120000`,
 * 2026-11-16), primera de dos. Solo AÑADE `contenido_firmas_documentos`, que la app nueva llama; la
 * segunda quita a la sesión las cuatro columnas. Criterio de `contenido_firmas` (opción b): el
 * trazo, la IP, el navegador y el nombre tecleado, a quien firmó, al tutor legal y a la Dirección. La
 * profe, no: la tabla ya no se la dejaba leer (3b), y la función no amplía. Al autorizado, a la profe
 * y a otro, nada (sin error: «no le toca» no es «falló»).
 *
 * La firma se monta como en la app: la admin sube el documento y el tutor legal firma con su sesión
 * (`firmar_documento_centro`). Ni la sesión ni `service_role` pueden insertar en la tabla.
 */
const TRAZO = 'data:image/png;base64,TUFSQ0EtVFJBWk8tRE9D'
const UA = 'MARCA-UA-DOC'

describe('contenido_firmas_documentos (primera de dos)', () => {
  let centro: { id: string }
  let nino: { id: string; familia_id: string }
  let legal: TestUser
  let legal2: TestUser
  let autorizado: TestUser
  let profe: TestUser
  let admin: TestUser
  let ajeno: TestUser
  let firma: string
  const usuarios: string[] = []
  const sesiones = new Map<string, SupabaseClient<Database>>()
  const como = async (u: TestUser) => {
    if (!sesiones.has(u.id)) sesiones.set(u.id, await clientFor(u))
    return sesiones.get(u.id)!
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Contenido Firmas Documentos')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Contenido Firmas Documentos')
    await matricular(nino.id, aula.id, curso.id)

    legal = await createTestUser({ nombre: 'Legal Contenido Firmas Documentos' })
    legal2 = await createTestUser({ nombre: 'Legal2 Contenido Firmas Documentos' })
    autorizado = await createTestUser({ nombre: 'Autorizado Contenido Firmas Documentos' })
    profe = await createTestUser({ nombre: 'Profe Contenido Firmas Documentos' })
    admin = await createTestUser({ nombre: 'Admin Contenido Firmas Documentos' })
    ajeno = await createTestUser({ nombre: 'Ajeno Contenido Firmas Documentos' })
    usuarios.push(legal.id, legal2.id, autorizado.id, profe.id, admin.id, ajeno.id)
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarProfeAula(profe.id, aula.id, curso.id)
    for (const u of [legal, legal2, ajeno]) await asignarRol(u.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await crearFamiliaTutor(nino.familia_id, legal.id, 'titular')
    await crearVinculo(nino.id, legal.id, 'tutor_legal_principal', {})
    await crearVinculo(nino.id, legal2.id, 'tutor_legal_secundario', {})
    await crearVinculo(nino.id, autorizado.id, 'autorizado', {})

    const doc = await creaDocumento(await como(admin), centro.id, 'Normas contenido firmas')
    const version = await subeVersion(await como(admin), centro.id, doc, null, 'normas v1')
    const f = await (
      await como(legal)
    ).rpc('firmar_documento_centro', {
      p_version_id: version,
      p_nino_id: nino.id,
      p_nombre_tecleado: 'Legal Contenido Firmas Documentos',
      p_firma_imagen: TRAZO,
      p_ip_address: '10.9.8.7',
      p_user_agent: UA,
    })
    if (f.error || !f.data) throw new Error(`firma: ${f.error?.message}`)
    firma = f.data
  })

  afterAll(async () => {
    await borrarDocumentosDe(centro.id)
    for (const u of usuarios) await deleteTestUser(u)
  })

  it('premisas: quién es quién con el niño, y la firma con su trazo', async () => {
    const { data: v } = await serviceClient
      .from('vinculos_familiares')
      .select('usuario_id, tipo_vinculo')
      .eq('nino_id', nino.id)
      .is('deleted_at', null)
    const tipo = new Map((v ?? []).map((x) => [x.usuario_id, x.tipo_vinculo]))
    expect(tipo.get(legal.id)).toBe('tutor_legal_principal')
    expect(tipo.get(legal2.id)).toBe('tutor_legal_secundario')
    expect(tipo.get(autorizado.id)).toBe('autorizado')
    expect(tipo.has(profe.id)).toBe(false)
    expect(tipo.has(ajeno.id)).toBe(false)
    const { data: esProfe } = await (
      await como(profe)
    ).rpc('es_profe_de_nino', { p_nino_id: nino.id })
    expect(esProfe).toBe(true)
    const { data: f } = await serviceClient
      .from('firmas_documentos_centro')
      .select('firmante_id, firma_imagen, user_agent')
      .eq('id', firma)
      .single()
    expect(f).toEqual({ firmante_id: legal.id, firma_imagen: TRAZO, user_agent: UA })
  })

  it('a quien firmó, al otro tutor legal y a la Dirección: el contenido entero', async () => {
    for (const u of [legal, legal2, admin]) {
      const { data, error } = await (
        await como(u)
      ).rpc('contenido_firmas_documentos', { p_firma_ids: [firma] })
      expect.soft(error, u.id).toBeNull()
      expect.soft(data, u.id).toEqual([
        {
          firma_id: firma,
          nombre_tecleado: 'Legal Contenido Firmas Documentos',
          firma_imagen: TRAZO,
          ip_address: '10.9.8.7',
          user_agent: UA,
        },
      ])
    }
  })

  it('al autorizado, a la profe del niño y a otro tutor del centro: nada, sin error', async () => {
    for (const u of [autorizado, profe, ajeno]) {
      const { data, error } = await (
        await como(u)
      ).rpc('contenido_firmas_documentos', { p_firma_ids: [firma] })
      expect.soft(error, u.id).toBeNull()
      expect.soft(data, u.id).toEqual([])
    }
  })

  it('sin sesión no se ejecuta', async () => {
    const { data, error } = await anonClient().rpc('contenido_firmas_documentos', {
      p_firma_ids: [firma],
    })
    expect(error?.code).toBe('42501')
    expect(data).toBeNull()
  })
})
