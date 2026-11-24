import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SesionConFallos } from './lectura-fallida'
import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestCurso,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * La reordenación de la lista de espera no deja dos familias en la misma posición (C, 2026-11-23).
 *
 * El panel manda los prospectos NO descartados en el orden nuevo y la acción les daba 1..N. Un
 * descartado conserva su posición: con A(1), B(2, descartado) y C(3), reordenar a [C, A] deja C=1 y
 * A=2, la de B. No hace falta concurrencia: pasa hoy con una sola directora y un solo arrastre. Es la
 * prueba de que la colisión existe, no un riesgo teórico (decisión del 2026-11-23).
 *
 * Lo que se afirma: después de reordenar, ninguna posición se repite en el curso, y el orden de los
 * no descartados es el que se pidió.
 */
const sesion = vi.hoisted(
  (): SesionConFallos => ({ actual: null, fallaTabla: null, fallaRpc: null, fallidas: 0 })
)
vi.mock('@/lib/supabase/server', async () => {
  const { clienteConFallos } = await import('./lectura-fallida')
  return { createClient: async () => clienteConFallos(sesion) }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { reordenarListaEspera } =
  await import('@/features/lista-espera/actions/reordenar-lista-espera')

describe('reordenar la lista de espera no repite posiciones', () => {
  let centroId: string
  let cursoId: string
  let admin: TestUser
  const id: Record<'A' | 'B' | 'C', string> = { A: '', B: '', C: '' }

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Lista Orden')
    centroId = centro.id
    cursoId = (await createTestCurso(centro.id)).id
    admin = await createTestUser({ nombre: 'Admin Lista Orden' })
    await asignarRol(admin.id, centro.id, 'admin')
    sesion.actual = await clientFor(admin)
  }, 60_000)

  afterAll(async () => {
    sesion.actual = null
    await serviceClient.from('lista_espera').delete().eq('curso_academico_id', cursoId)
    await deleteTestCentro(centroId)
    if (admin) await deleteTestUser(admin.id)
  }, 60_000)

  beforeEach(async () => {
    await serviceClient.from('lista_espera').delete().eq('curso_academico_id', cursoId)
    for (const [k, pos] of [
      ['A', 1],
      ['B', 2],
      ['C', 3],
    ] as const) {
      const r = await serviceClient
        .from('lista_espera')
        .insert({
          centro_id: centroId,
          curso_academico_id: cursoId,
          nombre_nino: `Prospecto ${k}`,
          primer_apellido_nino: 'Orden',
          posicion: pos,
        })
        .select('id')
        .single()
      if (r.error || !r.data) throw new Error(`prospecto ${k}: ${r.error?.message}`)
      id[k] = r.data.id
    }
    const d = await serviceClient
      .from('lista_espera')
      .update({ estado: 'descartado' })
      .eq('id', id.B)
    if (d.error) throw new Error(`descartar B: ${d.error.message}`)
  })

  async function posiciones() {
    const { data, error } = await serviceClient
      .from('lista_espera')
      .select('id, posicion, estado')
      .eq('curso_academico_id', cursoId)
    if (error) throw new Error(`leer la lista: ${error.message}`)
    return data
  }

  it('premisa: A(1), B descartado en 2, C(3)', async () => {
    const p = await posiciones()
    const de = (x: string) => p.find((f) => f.id === x)
    expect([de(id.A)?.posicion, de(id.B)?.posicion, de(id.C)?.posicion]).toEqual([1, 2, 3])
    expect(de(id.B)?.estado).toBe('descartado')
  })

  it('reordenar a [C, A]: sin posiciones repetidas, y C delante de A', async () => {
    const r = await reordenarListaEspera({ curso_academico_id: cursoId, orden: [id.C, id.A] })
    expect(r.success, `premisa: la reordenación corrió (${JSON.stringify(r)})`).toBe(true)
    const p = await posiciones()
    const vistas = p.map((f) => `${f.id === id.A ? 'A' : f.id === id.B ? 'B' : 'C'}=${f.posicion}`)
    expect(new Set(p.map((f) => f.posicion)).size, `posiciones: ${vistas.sort().join(', ')}`).toBe(
      p.length
    )
    const pos = (x: string) => p.find((f) => f.id === x)!.posicion
    expect(pos(id.C), 'C delante de A').toBeLessThan(pos(id.A))
  })
})
