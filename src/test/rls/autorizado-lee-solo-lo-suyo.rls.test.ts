import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import {
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
 * El autorizado lee solo lo suyo (`20270115120000`; decisiones del responsable del 2026-11-11).
 * Medido ABIERTO antes (en producción, ensayo terminado en RAISE; y la exportación en la base
 * efímera): el autorizado leía la fila entera del niño, las firmas del tutor legal con su trazo, su
 * IP y el DNI de las personas autorizadas, las recogidas de otros, la medicación sin permiso y las
 * fotos de DNI, y exportaba al niño con el libro de familia firmado por el servicio.
 *
 * Cada «no» lleva al lado su control positivo (el tutor legal, la Dirección o la profe siguen
 * leyendo lo suyo) y, antes, la premisa de quién es quién.
 */
const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async () =>
    Object.assign((k: string) => k, {
      has: () => true,
      rich: (k: string) => k,
      raw: (k: string) => k,
    }),
}))

const { GET } = await import('@/app/[locale]/export/[tipo]/[id]/route')

const PDF = Buffer.from('%PDF-1.4 test')
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9])
const MARCAS = { notas_admin: 'MARCA-NA', dni: '12345678Z', observaciones_familia: 'MARCA-OB' }

describe('el autorizado lee solo lo suyo', () => {
  let centro: { id: string }
  let nino: { id: string; familia_id: string }
  let legal: TestUser
  let autorizado: TestUser
  let profe: TestUser
  let admin: TestUser
  let ajeno: TestUser
  let recogidaLegal: string
  let recogidaPropia: string
  let medicacion: string
  let firmaLegal: string
  let dniAjeno: string
  let dniPropio: string
  let libro: string
  const usuarios: string[] = []
  const ficheros: Record<string, string[]> = {}

  async function subir(bucket: string, path: string, cuerpo: Buffer, tipo: string) {
    const { error } = await serviceClient.storage
      .from(bucket)
      .upload(path, cuerpo, { contentType: tipo, upsert: true })
    if (error) throw new Error(`subir ${bucket}: ${error.message}`)
    ;(ficheros[bucket] ??= []).push(path)
  }

  async function instancia(tipo: 'recogida' | 'medicacion', plantilla: string, creador: string) {
    const r = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo,
        es_plantilla: false,
        ambito: 'nino',
        nino_id: nino.id,
        plantilla_id: plantilla,
        titulo: `${tipo} test`,
        texto: 'Texto',
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: creador,
      })
      .select('id')
      .single()
    if (r.error || !r.data) throw new Error(`instancia: ${r.error?.message}`)
    return r.data.id
  }

  async function plantilla(tipo: 'recogida' | 'medicacion') {
    const r = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo,
        es_plantilla: true,
        titulo: `${tipo} (plantilla)`,
        texto: 'Texto',
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    if (r.error || !r.data) throw new Error(`plantilla: ${r.error?.message}`)
    return r.data.id
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Autorizado Solo Lo Suyo')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Solo Lo Suyo')
    await matricular(nino.id, aula.id, curso.id)

    legal = await createTestUser({ nombre: 'Legal Solo Lo Suyo' })
    autorizado = await createTestUser({ nombre: 'Autorizado Solo Lo Suyo' })
    profe = await createTestUser({ nombre: 'Profe Solo Lo Suyo' })
    admin = await createTestUser({ nombre: 'Admin Solo Lo Suyo' })
    ajeno = await createTestUser({ nombre: 'Ajeno Solo Lo Suyo' })
    usuarios.push(legal.id, autorizado.id, profe.id, admin.id, ajeno.id)
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarProfeAula(profe.id, aula.id, curso.id)
    await asignarRol(legal.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await asignarRol(ajeno.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(nino.familia_id, legal.id, 'titular')
    await crearVinculo(nino.id, legal.id, 'tutor_legal_principal', {
      puede_ver_info_medica: true,
      puede_firmar_autorizaciones: true,
    })
    await crearVinculo(nino.id, autorizado.id, 'autorizado', {})

    libro = `${centro.id}/${nino.id}/libro-${randomUUID()}.pdf`
    dniAjeno = `${centro.id}/${nino.id}/${randomUUID()}.jpg`
    await subir('libro-familia', libro, PDF, 'application/pdf')
    await subir('recogida-adjuntos', dniAjeno, JPG, 'image/jpeg')
    const n = await serviceClient
      .from('ninos')
      .update({ ...MARCAS, libro_familia_path: libro })
      .eq('id', nino.id)
    if (n.error) throw new Error(`marcas: ${n.error.message}`)

    const plR = await plantilla('recogida')
    const plM = await plantilla('medicacion')
    recogidaLegal = await instancia('recogida', plR, legal.id)
    recogidaPropia = await instancia('recogida', plR, autorizado.id)
    medicacion = await instancia('medicacion', plM, legal.id)
    const f = await serviceClient
      .from('firmas_autorizacion')
      .insert({
        autorizacion_id: recogidaLegal,
        nino_id: nino.id,
        firmante_id: legal.id,
        rol_firmante: 'tutor_legal_principal',
        decision: 'firmado',
        texto_hash: 'a'.repeat(64),
        texto_version: 'v1',
        nombre_tecleado: 'Legal Solo Lo Suyo',
        firma_imagen: 'MARCA-TRAZO',
        ip_address: '10.9.8.7',
        user_agent: 'MARCA-UA',
        datos: {
          personas: [{ nombre: 'Persona Demo', dni: '87654321X', parentesco: 'abuela' }],
          adjuntos: [{ bucket: 'recogida-adjuntos', path: dniAjeno, hash: 'x' }],
        },
      })
      .select('id')
      .single()
    if (f.error || !f.data) throw new Error(`firma: ${f.error?.message}`)
    firmaLegal = f.data.id
    const am = await serviceClient.from('administraciones_medicacion').insert({
      autorizacion_id: medicacion,
      nino_id: nino.id,
      centro_id: centro.id,
      administrado_por: admin.id,
      medicamento: 'MARCA-MED',
      dosis: '5 ml',
    })
    if (am.error) throw new Error(`administración: ${am.error.message}`)

    // La foto del DNI que sube el propio autorizado, con su sesión: queda a su nombre (`owner_id`).
    dniPropio = `${centro.id}/${nino.id}/${randomUUID()}.jpg`
    const c = await clientFor(autorizado)
    const up = await c.storage
      .from('recogida-adjuntos')
      .upload(dniPropio, JPG, { contentType: 'image/jpeg' })
    if (up.error) throw new Error(`subida del autorizado: ${up.error.message}`)
    ;(ficheros['recogida-adjuntos'] ??= []).push(dniPropio)
  })

  afterAll(async () => {
    for (const [b, ps] of Object.entries(ficheros)) await serviceClient.storage.from(b).remove(ps)
    for (const u of usuarios) await deleteTestUser(u)
  })

  it('premisas: quién es quién con el niño, y las marcas puestas', async () => {
    const { data: v } = await serviceClient
      .from('vinculos_familiares')
      .select('usuario_id, tipo_vinculo, permisos')
      .eq('nino_id', nino.id)
      .is('deleted_at', null)
    const porUsuario = new Map((v ?? []).map((x) => [x.usuario_id, x]))
    expect(porUsuario.get(autorizado.id)?.tipo_vinculo).toBe('autorizado')
    expect(porUsuario.get(autorizado.id)?.permisos).toEqual({})
    expect(porUsuario.get(legal.id)?.tipo_vinculo).toBe('tutor_legal_principal')
    expect(porUsuario.has(profe.id)).toBe(false)
    const { data: esProfe } = await (
      await clientFor(profe)
    ).rpc('es_profe_de_nino', {
      p_nino_id: nino.id,
    })
    expect(esProfe).toBe(true)
    const { data: n } = await serviceClient
      .from('ninos')
      .select('notas_admin, dni')
      .eq('id', nino.id)
      .single()
    expect(n).toEqual({ notas_admin: 'MARCA-NA', dni: '12345678Z' })
  })

  describe('ninos: la sesión lee la identidad; lo de gestión, por la función', () => {
    it('nadie lee de la tabla una columna de gestión, ni el tutor legal (42501)', async () => {
      for (const u of [autorizado, legal, profe, admin]) {
        const { error } = await (await clientFor(u))
          .from('ninos')
          .select('id, notas_admin')
          .eq('id', nino.id)
        expect.soft(error?.code, u.id).toBe('42501')
      }
    })

    it('control: la identidad la sigue leyendo cualquier vínculo y la profe', async () => {
      for (const u of [autorizado, legal, profe]) {
        const { data, error } = await (await clientFor(u))
          .from('ninos')
          .select('id, nombre, lugar_nacimiento')
          .eq('id', nino.id)
        expect.soft(error, u.id).toBeNull()
        expect.soft(data?.length, u.id).toBe(1)
      }
    })

    it('ficha_gestion_ninos: el tutor legal y la Dirección sí; la profe, el autorizado y el ajeno, no', async () => {
      const leer = async (u: TestUser) =>
        (await clientFor(u)).rpc('ficha_gestion_ninos', { p_nino_ids: [nino.id] })
      for (const u of [legal, admin]) {
        const { data, error } = await leer(u)
        expect.soft(error, u.id).toBeNull()
        expect.soft(data?.[0], u.id).toMatchObject(MARCAS)
      }
      for (const u of [profe, autorizado, ajeno]) {
        const { data, error } = await leer(u)
        expect.soft(error, u.id).toBeNull()
        expect.soft(data, u.id).toEqual([])
      }
    })
  })

  describe('firmas: la fila se ve; el contenido, solo a quien le toca', () => {
    it('el autorizado ve que el tutor legal firmó y cuándo (el estado), no su trazo', async () => {
      const c = await clientFor(autorizado)
      const estado = await c
        .from('firmas_autorizacion')
        .select('id, decision, firmado_at')
        .eq('id', firmaLegal)
      expect(estado.error).toBeNull()
      expect(estado.data?.length).toBe(1)
      const trazo = await c.from('firmas_autorizacion').select('firma_imagen').eq('id', firmaLegal)
      expect(trazo.error?.code).toBe('42501')
      const contenido = await c.rpc('contenido_firmas', { p_firma_ids: [firmaLegal] })
      expect(contenido.error).toBeNull()
      expect(contenido.data).toEqual([])
    })

    it('control: el tutor legal, la Dirección y la profe leen el contenido entero', async () => {
      for (const u of [legal, admin, profe]) {
        const { data, error } = await (
          await clientFor(u)
        ).rpc('contenido_firmas', {
          p_firma_ids: [firmaLegal],
        })
        expect.soft(error, u.id).toBeNull()
        expect.soft(data?.[0]?.firma_imagen, u.id).toBe('MARCA-TRAZO')
        expect.soft(JSON.stringify(data?.[0]?.datos ?? null), u.id).toContain('87654321X')
      }
    })
  })

  describe('autorizaciones de ámbito niño', () => {
    it('el autorizado ve la recogida que creó él, no la del tutor legal', async () => {
      const { data } = await (await clientFor(autorizado))
        .from('autorizaciones')
        .select('id')
        .in('id', [recogidaLegal, recogidaPropia])
      expect((data ?? []).map((a) => a.id)).toEqual([recogidaPropia])
    })

    it('control: el tutor legal ve las dos', async () => {
      const { data } = await (await clientFor(legal))
        .from('autorizaciones')
        .select('id')
        .in('id', [recogidaLegal, recogidaPropia])
      expect((data ?? []).map((a) => a.id).sort()).toEqual([recogidaLegal, recogidaPropia].sort())
    })
  })

  describe('medicación: con puede_ver_info_medica, como la ficha médica', () => {
    const permisoMedico = async (si: boolean) => {
      const { error } = await serviceClient
        .from('vinculos_familiares')
        .update({ permisos: si ? { puede_ver_info_medica: true } : {} })
        .eq('nino_id', nino.id)
        .eq('usuario_id', autorizado.id)
      if (error) throw new Error(error.message)
    }
    const veMedicacion = async (u: TestUser) => {
      const c = await clientFor(u)
      const adm = await c.from('administraciones_medicacion').select('id').eq('nino_id', nino.id)
      const aut = await c.from('autorizaciones').select('id').eq('id', medicacion)
      return [adm.data?.length ?? -1, aut.data?.length ?? -1]
    }

    it('sin el permiso, el autorizado no ve la medicación; con él, sí', async () => {
      await permisoMedico(false)
      expect(await veMedicacion(autorizado)).toEqual([0, 0])
      await permisoMedico(true)
      expect(await veMedicacion(autorizado)).toEqual([1, 1])
      await permisoMedico(false)
    })

    it('control: el tutor legal con el permiso la ve', async () => {
      expect(await veMedicacion(legal)).toEqual([1, 1])
    })
  })

  describe('fotos del DNI de recogida', () => {
    const firma = async (u: TestUser, path: string) => {
      const { data } = await (await clientFor(u)).storage
        .from('recogida-adjuntos')
        .createSignedUrl(path, 60)
      return data?.signedUrl ? (await fetch(data.signedUrl)).status : 0
    }

    it('el autorizado no abre la de otro; la suya, sí', async () => {
      expect(await firma(autorizado, dniAjeno)).toBe(0)
      expect(await firma(autorizado, dniPropio)).toBe(200)
    })

    it('control: el tutor legal abre las dos', async () => {
      expect(await firma(legal, dniAjeno)).toBe(200)
      expect(await firma(legal, dniPropio)).toBe(200)
    })
  })

  describe('la exportación del niño, por su ruta', () => {
    async function exportar(u: TestUser) {
      sesion.actual = await clientFor(u)
      const res = await GET(new Request('http://test.local'), {
        params: Promise.resolve({ locale: 'es', tipo: 'nino', id: nino.id }),
      })
      if (res.status !== 200) return { status: res.status, json: '', libro: 0 }
      const zip = await JSZip.loadAsync(await res.arrayBuffer())
      const json = (await zip.file('datos.json')?.async('string')) ?? ''
      const doc = JSON.parse(json) as {
        nino?: { adjuntos?: Array<{ descripcion: string; url_firmada: string | null }> }
      }
      const url = doc.nino?.adjuntos?.find((a) => a.descripcion === 'Libro de familia')?.url_firmada
      return { status: 200, json, libro: url ? (await fetch(url)).status : 0 }
    }

    it('el autorizado no exporta al niño (404)', async () => {
      expect((await exportar(autorizado)).status).toBe(404)
    })

    it('control: el tutor legal y la Dirección, con la nota y el libro', async () => {
      for (const u of [legal, admin]) {
        const r = await exportar(u)
        expect.soft(r.status, u.id).toBe(200)
        expect.soft(r.json, u.id).toContain('MARCA-NA')
        expect.soft(r.libro, u.id).toBe(200)
      }
    })

    it('la profe exporta por sesión, sin la nota, el DNI ni el libro', async () => {
      const r = await exportar(profe)
      expect(r.status).toBe(200)
      expect.soft(r.json).not.toContain('MARCA-NA')
      expect.soft(r.json).not.toContain('12345678Z')
      expect.soft(r.libro).toBe(0)
    })
  })
})
