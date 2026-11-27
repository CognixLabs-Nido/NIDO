import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database, Json } from '@/types/db'

import { clienteConFallos, type SesionConFallos } from './lectura-fallida'
import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  crearVinculo,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestCentro,
  type TestNino,
  type TestUser,
} from './setup'

/**
 * B2 (censo C; decisiones de Jose del 2026-11-26 y del 2026-11-27): «un cambio NUNCA sale de la cola si no
 * se aplicó. Si aplicar falla, se queda pendiente; si deshacer también falla, se queda pendiente y marcado
 * "falló al aplicar", con lo que pasó, y Dirección lo ve en su lista para reintentar».
 *
 * Medido abierto el 2026-11-26 con este mismo fichero (commit 4204f262): con aplicar y la vuelta a
 * 'pendiente' fallando, el cambio quedaba 'aprobado' sin aplicar y fuera de la cola. Desde
 * 20270209120000 la fila no sale de 'pendiente' mientras se aplica (la reserva, `aplicando_desde`), y
 * el doble fallo de hoy es otro: aplicar falla Y la escritura de «falló al aplicar» también. Contra la
 * base efímera de verdad; lo único simulado es el fallo. Fixtures ficticios.
 */
const fallo = vi.hoisted(() => ({ aplicar: false }))
const fallos = vi.hoisted(
  (): SesionConFallos => ({ actual: null, fallaTabla: null, fallaRpc: null, fallidas: 0 })
)

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => clienteConFallos(fallos),
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

const { aprobarCambio, rechazarCambio } =
  await import('@/features/cambios-pendientes/actions/decidir')
const { listarCambiosPendientes } = await import('@/features/cambios-pendientes/queries/get-cola')

describe('B2: un cambio que no se aplicó no sale de la cola', () => {
  let centro: TestCentro
  let nino: TestNino
  let directora: TestUser
  let tutor: TestUser
  let cDirectora: SupabaseClient<Database>

  const encolar = async (payload: Json, entidad = 'ninos_familia') => {
    const { data, error } = await serviceClient
      .from('cambios_pendientes')
      .insert({
        centro_id: centro.id,
        nino_id: nino.id,
        entidad,
        registro_id: nino.id,
        payload,
        solicitado_por: tutor.id,
      })
      .select('id')
      .single()
    if (error) throw new Error(`encolar: ${error.message}`)
    return data.id
  }
  const filaDe = async (id: string) => {
    const { data, error } = await serviceClient
      .from('cambios_pendientes')
      .select('estado, aplicando_desde, fallo_aplicar_at, fallo_aplicar_motivo, invita_tutor2')
      .eq('id', id)
      .single()
    expect(error).toBeNull()
    return data!
  }
  const enLaCola = async (id: string) => {
    fallos.actual = cDirectora
    return (await listarCambiosPendientes(centro.id)).find((c) => c.id === id) ?? null
  }
  const calle = async () =>
    (await serviceClient.from('ninos').select('direccion_calle').eq('id', nino.id).single()).data
      ?.direccion_calle
  const envejecer = async (id: string) => {
    const { error } = await serviceClient
      .from('cambios_pendientes')
      .update({ aplicando_desde: new Date(Date.now() - 3 * 60 * 1000).toISOString() })
      .eq('id', id)
    expect(error).toBeNull()
  }
  const sinFallos = () => {
    fallo.aplicar = false
    fallos.fallaRpc = null
    fallos.fallaTabla = null
    fallos.fallidas = 0
    fallos.actual = cDirectora
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Doble Fallo')
    nino = await createTestNino(centro.id, 'Nino Doble Fallo')
    directora = await createTestUser({ nombre: 'Directora Doble Fallo' })
    tutor = await createTestUser({ nombre: 'Tutor Doble Fallo' })
    await asignarRol(directora.id, centro.id, 'admin')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal')
    cDirectora = await clientFor(directora)
  }, 90_000)

  afterAll(async () => {
    await serviceClient.from('cambios_pendientes').delete().eq('nino_id', nino.id)
    for (const u of [directora, tutor]) await deleteTestUser(u.id)
    await deleteTestCentro(centro.id)
  }, 90_000)

  it('si aplicar falla: sigue pendiente, sin reserva y marcado «falló al aplicar», y Dirección lo ve', async () => {
    sinFallos()
    const id = await encolar({ direccion_calle: 'Calle Uno' })
    expect(await enLaCola(id), 'premisa: el cambio está en la cola').not.toBeNull()
    fallo.aplicar = true
    const r = await aprobarCambio(id)
    sinFallos()
    expect(r).toEqual({ success: false, error: 'admin.pendientes.errors.aplicar' })
    expect(await filaDe(id)).toMatchObject({
      estado: 'pendiente',
      aplicando_desde: null,
      fallo_aplicar_motivo: 'aplicar',
    })
    expect((await filaDe(id)).fallo_aplicar_at).not.toBeNull()
    expect((await enLaCola(id))?.intento).toMatchObject({ tipo: 'fallo', motivo: 'aplicar' })

    // Y se reintenta: aplica, sale de la cola como aprobado.
    expect(await aprobarCambio(id)).toEqual({ success: true, data: { id, tutor2: 'no_aplica' } })
    expect(await calle()).toBe('Calle Uno')
    expect((await filaDe(id)).estado).toBe('aprobado')
    expect(await enLaCola(id)).toBeNull()
  })

  it('doble fallo (aplicar y marcar el fallo): sigue pendiente y en la cola; a los 2 minutos se reintenta', async () => {
    sinFallos()
    const id = await encolar({ direccion_calle: 'Calle Doble' })
    expect(await enLaCola(id), 'premisa: el cambio está en la cola').not.toBeNull()
    fallo.aplicar = true
    fallos.fallaRpc = 'marcar_fallo_cambio_pendiente'
    const r = await aprobarCambio(id)
    // Premisa: el segundo fallo entró (la escritura de «falló al aplicar» contestó error).
    expect(fallos.fallidas).toBe(1)
    sinFallos()
    expect(r.success).toBe(false)
    const fila = await filaDe(id)
    expect(fila.estado).toBe('pendiente')
    expect(fila.aplicando_desde).not.toBeNull()
    // Dirección lo ve: «se está aplicando» mientras dura la reserva…
    expect((await enLaCola(id))?.intento?.tipo).toBe('aplicandose')
    // …y la base no deja aprobarlo a la vez.
    expect(await aprobarCambio(id)).toEqual({
      success: false,
      error: 'admin.pendientes.errors.aplicandose',
    })
    // Pasados los 2 minutos: «no consta que se haya aplicado», y aprobarlo aplica.
    await envejecer(id)
    expect((await enLaCola(id))?.intento?.tipo).toBe('sin_constancia')
    expect(await aprobarCambio(id)).toEqual({ success: true, data: { id, tutor2: 'no_aplica' } })
    expect(await calle()).toBe('Calle Doble')
    expect(await filaDe(id)).toMatchObject({ estado: 'aprobado', aplicando_desde: null })
  })

  it('dos aprobaciones a la vez: una aplica y la otra recibe «se está aplicando»', async () => {
    sinFallos()
    const id = await encolar({ direccion_calle: 'Calle Dos' })
    const [a, b] = await Promise.all([aprobarCambio(id), aprobarCambio(id)])
    const ok = [a, b].filter((x) => x.success)
    const ko = [a, b].filter((x) => !x.success)
    expect(ok).toHaveLength(1)
    expect(ko).toHaveLength(1)
    // La perdedora llega con la fila reservada (aplicándose) o ya aprobada (no pendiente).
    expect([
      'admin.pendientes.errors.aplicandose',
      'admin.pendientes.errors.no_pendiente',
    ]).toContain((ko[0] as { error: string }).error)
    expect((await filaDe(id)).estado).toBe('aprobado')
  })

  it('las columnas nuevas nacen vacías, aunque el tutor las mande', async () => {
    sinFallos()
    const cTutor = await clientFor(tutor)
    const { data, error } = await cTutor
      .from('cambios_pendientes')
      .insert({
        centro_id: centro.id,
        nino_id: nino.id,
        entidad: 'ninos_familia',
        registro_id: nino.id,
        payload: { direccion_calle: 'Calle Trampa' },
        solicitado_por: tutor.id,
        aplicando_desde: new Date(Date.now() + 3_600_000).toISOString(),
        fallo_aplicar_at: new Date().toISOString(),
        fallo_aplicar_motivo: 'aplicar',
        invita_tutor2: false,
      })
      .select('id')
      .single()
    // Premisa: el tutor legal puede encolar (la política de INSERT le deja).
    expect(error).toBeNull()
    expect(await filaDe(data!.id)).toEqual({
      estado: 'pendiente',
      aplicando_desde: null,
      fallo_aplicar_at: null,
      fallo_aplicar_motivo: null,
      invita_tutor2: null,
    })
  })

  it('rechazar un mandato que la base no deja decidir: sigue pendiente y marcado, no rechazado', async () => {
    sinFallos()
    // Un mandato que no existe: `decidir_mandato_propuesto` contesta 42501, como si fallara.
    const id = await encolar({ mandato_id: randomUUID() }, 'mandato_sepa')
    expect(await rechazarCambio(id)).toEqual({
      success: false,
      error: 'admin.pendientes.errors.decidir',
    })
    expect(await filaDe(id)).toMatchObject({
      estado: 'pendiente',
      aplicando_desde: null,
      fallo_aplicar_motivo: 'rechazar_mandato',
    })
    expect((await enLaCola(id))?.intento).toMatchObject({
      tipo: 'fallo',
      motivo: 'rechazar_mandato',
    })
  })
})
