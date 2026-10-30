import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from '../rls/setup'

/**
 * `export_log` a 5 años (PR-A2; 20261210120000).
 *
 * Cada fila se borra cuando tiene más del plazo desde su `created_at`; en simulación solo se
 * cuentan. Las peticiones de olvido no tienen plazo y no entran aquí.
 *
 * Las filas que vencen son de hace 30 años y la purga real se pide con 20: así solo alcanza a las
 * de este fichero aunque la BD la compartan otros tests. La de hace 10 años y la de hoy se quedan.
 */

const HACE = (anios: number) => new Date(Date.now() - anios * 365 * 864e5).toISOString()

describe('Retención de export_log', () => {
  let centro: { id: string }
  let admin: TestUser

  beforeAll(async () => {
    centro = await createTestCentro('Centro Retencion Export Log')
    admin = await createTestUser({ nombre: 'Admin Retencion Export Log' })
    await asignarRol(admin.id, centro.id, 'admin')
  }, 120_000)

  afterAll(async () => {
    await serviceClient.from('export_log').delete().eq('centro_id', centro.id)
    await deleteTestUser(admin.id)
    await deleteTestCentro(centro.id)
  }, 120_000)

  async function export_(createdAt: string): Promise<string> {
    const { data, error } = await serviceClient
      .from('export_log')
      .insert({
        sujeto_tipo: 'usuario',
        sujeto_id: admin.id,
        solicitado_por: admin.id,
        centro_id: centro.id,
        created_at: createdAt,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    return data!.id
  }

  async function existe(id: string): Promise<boolean> {
    const { data, error } = await serviceClient
      .from('export_log')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    expect(error).toBeNull()
    return data !== null
  }

  it('borra las vencidas y conserva el resto; en simulación solo cuenta', async () => {
    const vencida = await export_(HACE(30))
    const quedan = [await export_(HACE(10)), await export_(new Date().toISOString())]
    // Premisa: las tres están, y la vencida tiene la fecha que se le dio.
    for (const id of [vencida, ...quedan]) expect(await existe(id)).toBe(true)
    const { data: v } = await serviceClient
      .from('export_log')
      .select('created_at')
      .eq('id', vencida)
      .single()
    expect(new Date(v!.created_at).getTime()).toBeLessThan(Date.parse(HACE(29)))

    const sim = await serviceClient.rpc('purgar_export_log', { p_anios: 20, p_simular: true })
    expect(sim.error).toBeNull()
    expect(sim.data).toBeGreaterThanOrEqual(1)
    expect(await existe(vencida)).toBe(true)

    const real = await serviceClient.rpc('purgar_export_log', { p_anios: 20, p_simular: false })
    expect(real.error).toBeNull()
    expect(real.data).toBeGreaterThanOrEqual(1)
    expect(await existe(vencida)).toBe(false)
    for (const id of quedan) expect(await existe(id)).toBe(true)
  })

  it('un plazo que no vale no borra nada', async () => {
    const { error } = await serviceClient.rpc('purgar_export_log', { p_anios: 0, p_simular: false })
    expect(error?.code).toBe('22023')
  })

  it('con sesión no se ejecuta', async () => {
    const c = await clientFor(admin)
    const { error } = await c.rpc('purgar_export_log', { p_anios: 1, p_simular: true })
    expect(error?.code).toBe('42501')
  })
})
