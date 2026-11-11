import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * SONDA 2 (rama mut/, no se mergea): ejecuta el GET real de `/export/[tipo]/[id]` con la sesión
 * real de cada uno, sobre `main` sin arreglo. Predicciones en
 * ~/nido-logs/agujero/predicciones-abierto.md («Las rutas, ejecutadas»).
 */
const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('sonda: falta la sesión de quien actúa')
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

const PDF = Buffer.from('%PDF-1.4 sonda')
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9])

type Adjunto = { descripcion: string; url_firmada: string | null }
type Resultado = { status: number; json: string; adjuntos: Adjunto[] }

async function exportar(quien: TestUser, tipo: 'nino' | 'usuario', id: string): Promise<Resultado> {
  sesion.actual = await clientFor(quien)
  const res = await GET(new Request('http://sonda.local'), {
    params: Promise.resolve({ locale: 'es', tipo, id }),
  })
  if (res.status !== 200) return { status: res.status, json: '', adjuntos: [] }
  const zip = await JSZip.loadAsync(await res.arrayBuffer())
  const json = (await zip.file('datos.json')?.async('string')) ?? ''
  const doc = JSON.parse(json) as {
    nino?: { adjuntos?: Adjunto[] }
    usuario?: { adjuntos?: Adjunto[] }
  }
  return { status: 200, json, adjuntos: doc.nino?.adjuntos ?? doc.usuario?.adjuntos ?? [] }
}

const descarga = async (url: string | null | undefined) => (url ? (await fetch(url)).status : 0)
const adjunto = (r: Resultado, d: string) => r.adjuntos.find((a) => a.descripcion === d)

describe('SONDA 2 · las rutas de exportación con un autorizado (abierto)', () => {
  let centro: { id: string }
  let nino: { id: string; familia_id: string }
  let legal: TestUser
  let autorizado: TestUser
  let ajeno: TestUser
  let admin: TestUser
  const rutas: Record<string, string[]> = {}
  const usuarios: string[] = []

  async function subir(bucket: string, path: string, cuerpo: Buffer, tipo: string) {
    const { error } = await serviceClient.storage
      .from(bucket)
      .upload(path, cuerpo, { contentType: tipo, upsert: true })
    if (error) throw new Error(`subir ${bucket}: ${error.message}`)
    ;(rutas[bucket] ??= []).push(path)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Sonda Rutas')
    nino = await createTestNino(centro.id, 'Nino Sonda Rutas')
    legal = await createTestUser({ nombre: 'Legal Sonda Rutas' })
    autorizado = await createTestUser({ nombre: 'Autorizado Sonda Rutas' })
    ajeno = await createTestUser({ nombre: 'Ajeno Sonda Rutas' })
    admin = await createTestUser({ nombre: 'Admin Sonda Rutas' })
    usuarios.push(legal.id, autorizado.id, ajeno.id, admin.id)
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(legal.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await asignarRol(ajeno.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(nino.familia_id, legal.id, 'titular')
    await crearVinculo(nino.id, legal.id, 'tutor_legal_principal', {
      puede_firmar_autorizaciones: true,
    })
    await crearVinculo(nino.id, autorizado.id, 'autorizado', {})

    const libro = `${centro.id}/${nino.id}/libro-${randomUUID()}.pdf`
    const dniTutor = `${centro.id}/${nino.id}/dni-${randomUUID()}.pdf`
    const dniRecogida = `${centro.id}/${nino.id}/${randomUUID()}.jpg`
    await subir('libro-familia', libro, PDF, 'application/pdf')
    await subir('dni-tutores', dniTutor, PDF, 'application/pdf')
    await subir('recogida-adjuntos', dniRecogida, JPG, 'image/jpeg')

    const n = await serviceClient
      .from('ninos')
      .update({ notas_admin: 'MARCA-NA', dni: '12345678Z', libro_familia_path: libro })
      .eq('id', nino.id)
    if (n.error) throw new Error(`ninos: ${n.error.message}`)
    const ft = await serviceClient
      .from('familia_tutores')
      .update({ dni_documento_path: dniTutor })
      .eq('familia_id', nino.familia_id)
      .eq('usuario_id', legal.id)
    if (ft.error) throw new Error(`familia_tutores: ${ft.error.message}`)

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
        titulo: 'Recogida de LEGAL',
        texto: 'Texto',
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: legal.id,
      })
      .select('id')
      .single()
    if (inst.error || !inst.data) throw new Error(`instancia: ${inst.error?.message}`)
    const f = await serviceClient.from('firmas_autorizacion').insert({
      autorizacion_id: inst.data.id,
      nino_id: nino.id,
      firmante_id: legal.id,
      rol_firmante: 'tutor_legal_principal',
      decision: 'firmado',
      texto_hash: 'a'.repeat(64),
      texto_version: 'v1',
      nombre_tecleado: 'Legal Sonda',
      firma_imagen: 'MARCA-TRAZO',
      datos: {
        personas: [{ nombre: 'Persona Demo', dni: '87654321X', parentesco: 'abuela' }],
        adjuntos: [{ bucket: 'recogida-adjuntos', path: dniRecogida, hash: 'x' }],
      },
    })
    if (f.error) throw new Error(`firma: ${f.error.message}`)
  })

  afterAll(async () => {
    for (const [b, ps] of Object.entries(rutas)) await serviceClient.storage.from(b).remove(ps)
    for (const u of usuarios) await deleteTestUser(u)
  })

  it('P · premisas: el vínculo es de autorizado y LEGAL es su tutor legal con perfil de familia', async () => {
    const { data } = await serviceClient
      .from('vinculos_familiares')
      .select('usuario_id, tipo_vinculo')
      .eq('nino_id', nino.id)
    expect(new Map((data ?? []).map((v) => [v.usuario_id, v.tipo_vinculo]))).toEqual(
      new Map([
        [legal.id, 'tutor_legal_principal'],
        [autorizado.id, 'autorizado'],
      ])
    )
  })

  it('H0 · sin vínculo: 404', async () => {
    expect((await exportar(ajeno, 'nino', nino.id)).status).toBe(404)
  })

  it('H1-H4 · el autorizado exporta al niño por la ruta', async () => {
    const r = await exportar(autorizado, 'nino', nino.id)
    expect(r.status).toBe(200) // H1
    expect.soft(r.json).toContain('MARCA-NA') // H1
    expect.soft(r.json).toContain('12345678Z') // H1
    expect.soft(await descarga(adjunto(r, 'Libro de familia')?.url_firmada)).toBe(200) // H2
    expect.soft(r.adjuntos.map((a) => a.descripcion)).not.toContain('DNI') // H3
    expect
      .soft(r.adjuntos.map((a) => a.descripcion))
      .not.toContain('DNI de persona autorizada a recoger') // H3
    expect.soft(r.json).not.toContain('MARCA-TRAZO') // H4
    expect.soft(r.json).not.toContain('87654321X') // H4 (el DNI de la persona, en datos de la firma)
  })

  it('H5 · control positivo: LEGAL exporta al niño, con la nota y el libro', async () => {
    const r = await exportar(legal, 'nino', nino.id)
    expect(r.status).toBe(200)
    expect.soft(r.json).toContain('MARCA-NA')
    expect.soft(await descarga(adjunto(r, 'Libro de familia')?.url_firmada)).toBe(200)
  })

  it('U0 · el autorizado exporta a LEGAL como usuario', async () => {
    const r = await exportar(autorizado, 'usuario', legal.id)
    expect(r.status).toBe(404)
  })

  it('U1 · control positivo: LEGAL se exporta a sí mismo, con su DNI y el de la recogida', async () => {
    const r = await exportar(legal, 'usuario', legal.id)
    expect(r.status).toBe(200)
    expect.soft(await descarga(adjunto(r, 'DNI')?.url_firmada)).toBe(200)
    expect
      .soft(await descarga(adjunto(r, 'DNI de persona autorizada a recoger')?.url_firmada))
      .toBe(200)
  })

  it('U2 · control positivo de Dirección: la admin exporta a LEGAL', async () => {
    expect((await exportar(admin, 'usuario', legal.id)).status).toBe(200)
  })
})
