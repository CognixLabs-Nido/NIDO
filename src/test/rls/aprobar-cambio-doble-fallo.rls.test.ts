import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestCentro,
  type TestNino,
  type TestUser,
} from './setup'

/**
 * MEDIDO ABIERTO (censo C, decisión de Jose del 2026-11-26): «monta el doble fallo y enséñame en qué estado
 * queda el cambio hoy». `aprobarCambio` marca la fila 'aprobado' ANTES de aplicar; si aplicar falla, la
 * devuelve a 'pendiente' con `revertir()`, cuyo resultado se tira. La regla de Jose: «NUNCA SALGA DE LA COLA
 * SI NO SE APLICÓ». Contra la base efímera de verdad; lo único simulado es el fallo: aplicar lanza, y el UPDATE
 * de vuelta a 'pendiente' contesta un error, como lo haría la red. Fixtures ficticios del 2026-11-26.
 */
const fallo = vi.hoisted(() => ({ aplicar: false, revertir: false }))
const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/cambios-pendientes/lib/aplicar', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/cambios-pendientes/lib/aplicar')>()
  return {
    ...real,
    aplicarCambioPendiente: async (...a: Parameters<typeof real.aplicarCambioPendiente>) => {
      if (fallo.aplicar) throw new Error('aplicar: fallo simulado')
      return real.aplicarCambioPendiente(...a)
    },
  }
})

const { aprobarCambio } = await import('@/features/cambios-pendientes/actions/decidir')
const { listarCambiosPendientes } = await import('@/features/cambios-pendientes/queries/get-cola')

/** La sesión de Dirección, con el UPDATE de vuelta a 'pendiente' fallando si `fallo.revertir`. */
function conRevertirQueFalla(c: SupabaseClient<Database>): SupabaseClient<Database> {
  return new Proxy(c, {
    get(t, k) {
      if (k === 'from')
        return (tabla: string) => {
          const b = t.from(tabla as 'cambios_pendientes')
          if (tabla !== 'cambios_pendientes') return b
          return new Proxy(b, {
            get(bt, bk) {
              if (bk === 'update')
                return (v: { estado?: string }) =>
                  fallo.revertir && v?.estado === 'pendiente'
                    ? {
                        eq: () =>
                          Promise.resolve({
                            data: null,
                            error: { message: 'revertir: fallo simulado', code: 'XX000' },
                          }),
                      }
                    : bt.update(v as never)
              const val = Reflect.get(bt, bk)
              return typeof val === 'function' ? val.bind(bt) : val
            },
          })
        }
      const v = Reflect.get(t, k)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
}

describe('aprobarCambio: un cambio que no se aplicó no sale de la cola (medido abierto)', () => {
  let centro: TestCentro
  let nino: TestNino
  let directora: TestUser
  let tutor: TestUser
  let cDirectora: SupabaseClient<Database>

  const encolar = async (calle: string) => {
    const { data, error } = await serviceClient
      .from('cambios_pendientes')
      .insert({
        centro_id: centro.id,
        nino_id: nino.id,
        entidad: 'ninos_familia',
        registro_id: nino.id,
        payload: { direccion_calle: calle },
        solicitado_por: tutor.id,
      })
      .select('id')
      .single()
    if (error) throw new Error(`encolar: ${error.message}`)
    return data.id
  }
  const estadoDe = async (id: string) =>
    (await serviceClient.from('cambios_pendientes').select('estado').eq('id', id).single()).data
      ?.estado
  const enLaCola = async (id: string) => {
    sesion.actual = cDirectora
    return (await listarCambiosPendientes(centro.id)).some((c) => c.id === id)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Doble Fallo')
    nino = await createTestNino(centro.id, 'Nino Doble Fallo')
    directora = await createTestUser({ nombre: 'Directora Doble Fallo' })
    tutor = await createTestUser({ nombre: 'Tutor Doble Fallo' })
    await asignarRol(directora.id, centro.id, 'admin')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    cDirectora = await clientFor(directora)
  }, 90_000)

  afterAll(async () => {
    await serviceClient.from('cambios_pendientes').delete().eq('nino_id', nino.id)
    for (const u of [directora, tutor]) await deleteTestUser(u.id)
    await deleteTestCentro(centro.id)
  }, 90_000)

  it('control: si solo falla aplicar, el cambio vuelve a pendiente y sigue en la cola', async () => {
    const id = await encolar('Calle Control')
    expect(await enLaCola(id), 'premisa: el cambio está en la cola antes de aprobar').toBe(true)
    fallo.aplicar = true
    fallo.revertir = false
    sesion.actual = conRevertirQueFalla(cDirectora)
    const r = await aprobarCambio(id)
    fallo.aplicar = false
    expect(r.success).toBe(false)
    expect(await estadoDe(id)).toBe('pendiente')
    expect(await enLaCola(id)).toBe(true)
  })

  it('doble fallo (aplicar y deshacer): el cambio sigue en la cola', async () => {
    const id = await encolar('Calle Doble')
    expect(await enLaCola(id), 'premisa: el cambio está en la cola antes de aprobar').toBe(true)
    fallo.aplicar = true
    fallo.revertir = true
    sesion.actual = conRevertirQueFalla(cDirectora)
    const r = await aprobarCambio(id)
    fallo.aplicar = false
    fallo.revertir = false
    // Lo que contesta la acción, y dónde queda la fila: los dos se miden (expect.soft no para).
    expect.soft(r).toEqual({ success: false, error: 'admin.pendientes.errors.aplicar' })
    expect.soft(await estadoDe(id), 'estado de la fila tras el doble fallo').toBe('pendiente')
    expect.soft(await enLaCola(id), '¿sigue en la cola de Dirección?').toBe(true)
  })
})
