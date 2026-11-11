import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import { recolectarNino } from '@/features/export/lib/recolectar'
import type { AdjuntoExport } from '@/features/export/types'

/**
 * SONDA (rama mut/, no se mergea): mide ABIERTA la exportación del niño para un autorizado,
 * sobre `main` sin arreglo. Predicciones en ~/nido-logs/agujero/predicciones-abierto.md.
 * Los asertos describen el estado ABIERTO: verde = el agujero existe.
 */
describe('SONDA · el autorizado y la exportación del niño (abierto)', () => {
  let centro: { id: string }
  let nino: { id: string }
  let legal: TestUser
  let autorizado: TestUser
  let ajeno: TestUser
  let libro: string
  const usuarios: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Sonda Export')
    nino = await createTestNino(centro.id, 'Nino Sonda Export')
    legal = await createTestUser({ nombre: 'Legal Sonda' })
    autorizado = await createTestUser({ nombre: 'Autorizado Sonda' })
    ajeno = await createTestUser({ nombre: 'Ajeno Sonda' })
    usuarios.push(legal.id, autorizado.id, ajeno.id)
    await asignarRol(legal.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await asignarRol(ajeno.id, centro.id, 'tutor_legal')
    await crearVinculo(nino.id, legal.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
    await crearVinculo(nino.id, autorizado.id, 'autorizado', {})

    libro = `${centro.id}/${nino.id}/libro-sonda.pdf`
    const up = await serviceClient.storage
      .from('libro-familia')
      .upload(libro, Buffer.from('%PDF-1.4 sonda'), { contentType: 'application/pdf', upsert: true })
    if (up.error) throw new Error(`subida: ${up.error.message}`)
    const { error } = await serviceClient
      .from('ninos')
      .update({ notas_admin: 'MARCA-NA', dni: '12345678Z', libro_familia_path: libro })
      .eq('id', nino.id)
    if (error) throw new Error(`marcas: ${error.message}`)
  })

  afterAll(async () => {
    await serviceClient.storage.from('libro-familia').remove([libro])
    for (const u of usuarios) await deleteTestUser(u)
  })

  const libroDe = (a: unknown) =>
    ((a ?? []) as AdjuntoExport[]).find((x) => x.descripcion === 'Libro de familia')
  const estado = async (url: string | null | undefined) => (url ? (await fetch(url)).status : 0)

  it('P · premisas: el vínculo es de autorizado, sin permisos; la nota y el libro están', async () => {
    const { data: v } = await serviceClient
      .from('vinculos_familiares')
      .select('tipo_vinculo, permisos')
      .eq('nino_id', nino.id)
      .eq('usuario_id', autorizado.id)
      .single()
    expect(v?.tipo_vinculo).toBe('autorizado')
    expect(v?.permisos).toEqual({})
    const { data: n } = await serviceClient
      .from('ninos')
      .select('notas_admin, libro_familia_path')
      .eq('id', nino.id)
      .single()
    expect(n).toEqual({ notas_admin: 'MARCA-NA', libro_familia_path: libro })
  })

  it('C1 · con su sesión, el autorizado no firma el libro: el bucket es del tutor legal', async () => {
    const c = await clientFor(autorizado)
    const { data } = await c.storage.from('libro-familia').createSignedUrl(libro, 60)
    expect(data?.signedUrl ?? null).toBeNull()
  })

  it('C2 · control positivo: el tutor legal descarga el libro desde su exportación', async () => {
    const r = await recolectarNino(await clientFor(legal), serviceClient, nino.id)
    expect(await estado(libroDe(r?.data.adjuntos)?.url_firmada)).toBe(200)
  })

  it('C3 · control negativo: sin vínculo, no hay exportación', async () => {
    expect(await recolectarNino(await clientFor(ajeno), serviceClient, nino.id)).toBeNull()
  })

  it('E1 · ABIERTO: la exportación del autorizado lleva la nota de Dirección y el DNI', async () => {
    const r = await recolectarNino(await clientFor(autorizado), serviceClient, nino.id)
    const texto = JSON.stringify(r?.data ?? null)
    expect.soft(texto).toContain('MARCA-NA')
    expect.soft(texto).toContain('12345678Z')
  })

  it('E2 · ABIERTO: el autorizado descarga el libro, firmado por el servicio', async () => {
    const r = await recolectarNino(await clientFor(autorizado), serviceClient, nino.id)
    expect(await estado(libroDe(r?.data.adjuntos)?.url_firmada)).toBe(200)
  })
})
