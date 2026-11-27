// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

/**
 * Censo C (B1, lista blanca, 2026-11-26): el export (art. 15) con una lectura o una escritura caídas.
 *  - `registrarExport` tiraba el error del INSERT en `export_log`: el `catch` de las rutas (que lo manda a
 *    Sentry y entrega el export igual) no se disparaba nunca. Ahora lanza.
 *  - el adjunto sin firmar salía con `url_firmada: null`, sin decirlo: ahora lanza. Salvo si el fichero
 *    no está en Storage (404): eso es una ausencia, no un fallo, y el export sale diciéndolo en ese
 *    adjunto (lanzar dejaba a la persona sin su copia entera; medido en la CI, export.rls e06).
 *  - el export del tutor sin cuenta: sin el centro de su familia, `centroId` null y el export no quedaba
 *    registrado. Ahora lanza.
 * Fixtures ficticios.
 */
vi.mock('server-only', () => ({}))
const { estado } = vi.hoisted(() => ({
  estado: { insertFalla: false, familiaCaida: false, firmaFalla: false, noEsta: false },
}))
const CAIDA = { code: 'XX000', message: 'caída' }
// Lo que contesta Storage a un objeto que no existe (`StorageApiError`).
const NO_ESTA = { message: 'Object not found', status: 400, statusCode: '404' }

const { registrarExport } = await import('../registrar')
const { recolectarTutor } = await import('../recolectar')

const service = {
  from: () => ({ insert: async () => ({ error: estado.insertFalla ? CAIDA : null }) }),
  storage: {
    from: () => ({
      createSignedUrl: async () =>
        estado.firmaFalla
          ? { data: null, error: CAIDA }
          : estado.noEsta
            ? { data: null, error: NO_ESTA }
            : { data: { signedUrl: 'https://firmada' }, error: null },
    }),
  },
} as unknown as SupabaseClient<Database>

const client = {
  rpc: async () => ({
    data: { perfiles_familia: [{ familia_id: 'f-1', dni_documento_path: 'c-1/n-1/dni.pdf' }] },
    error: null,
  }),
  from: () => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) c[m] = () => c
    c.maybeSingle = async () =>
      estado.familiaCaida
        ? { data: null, error: CAIDA }
        : { data: { centro_id: 'c-1' }, error: null }
    return c
  },
} as unknown as SupabaseClient<Database>

beforeEach(() => {
  estado.insertFalla = false
  estado.familiaCaida = false
  estado.firmaFalla = false
  estado.noEsta = false
})

describe('registrarExport', () => {
  const sujetos = [{ sujeto_tipo: 'nino' as const, sujeto_id: 'n-1', centro_id: 'c-1' }]
  it('premisa: con el INSERT bien, no lanza', async () => {
    await expect(registrarExport(service, sujetos, 'u-1')).resolves.toBeUndefined()
  })
  it('si el registro no se escribe: lanza (y la ruta lo manda a Sentry)', async () => {
    estado.insertFalla = true
    await expect(registrarExport(service, sujetos, 'u-1')).rejects.toThrow(/export_log/)
  })
})

describe('recolectarTutor (el tutor sin cuenta)', () => {
  it('premisa: con todo leído, su centro y su DNI firmado', async () => {
    const r = await recolectarTutor(client, service, 'ft-1')
    expect(r?.centroId).toBe('c-1')
    expect(JSON.stringify(r?.data)).toContain('https://firmada')
  })
  it('sin el centro de su familia: lanza, no un export sin registrar', async () => {
    estado.familiaCaida = true
    await expect(recolectarTutor(client, service, 'ft-1')).rejects.toThrow(/familias/)
  })
  it('sin firmar su DNI: lanza, no un adjunto sin enlace', async () => {
    estado.firmaFalla = true
    await expect(recolectarTutor(client, service, 'ft-1')).rejects.toThrow(/firmar/)
  })
  it('su DNI no está en Storage (404): el export sale, y el adjunto dice por qué no tiene enlace', async () => {
    estado.noEsta = true
    const r = await recolectarTutor(client, service, 'ft-1')
    expect(r?.data.adjuntos).toEqual([
      expect.objectContaining({
        path: 'c-1/n-1/dni.pdf',
        url_firmada: null,
        sin_enlace: 'fichero_no_encontrado',
      }),
    ])
  })
})
