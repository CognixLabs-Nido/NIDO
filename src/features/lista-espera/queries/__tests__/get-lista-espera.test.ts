import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { getListaEsperaCore } from '../get-lista-espera'

/**
 * Hueco 1 (alta del 2.º hijo) — `necesita_parentesco`: "Invitar" pide el parentesco SOLO si el
 * prospecto trae la cuenta del tutor y ese tutor no tiene NINGÚN vínculo del que heredarlo.
 * La lectura de vínculos va por el cliente service (misma que `vincularHijoATutorExistente`).
 */

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))

type Fila = {
  id: string
  tutor_usuario_id: string | null
  nino_id: string | null
}

function fila(f: Fila) {
  return {
    nombre_nino: 'Niño',
    apellidos_nino: 'Demo',
    fecha_nacimiento: null,
    telefono_tutor: null,
    email_tutor: null,
    nota: null,
    posicion: 1,
    estado: 'en_espera',
    ...f,
  }
}

/** Builder thenable: todas las cadenas devuelven el mismo resultado de la tabla. */
function fakeClient(porTabla: Record<string, { data: unknown; error: unknown }>) {
  const inSpy = vi.fn()
  const from = vi.fn((table: string) => {
    const b: Record<string, unknown> = {}
    const self = () => b as never
    b.select = () => self()
    b.eq = () => self()
    b.neq = () => self()
    b.is = () => self()
    b.order = () => self()
    b.in = (col: string, vals: unknown[]) => {
      inSpy(table, col, vals)
      return self()
    }
    b.then = (resolve: (v: unknown) => void) =>
      resolve(porTabla[table] ?? { data: null, error: null })
    return b
  })
  return { client: { from } as unknown as SupabaseClient<Database>, from, inSpy }
}

describe('getListaEsperaCore — necesita_parentesco (hueco 1)', () => {
  it('marca solo al tutor guardado SIN vínculo; con vínculo o familia nueva, no', async () => {
    const admin = fakeClient({
      lista_espera: {
        data: [
          fila({ id: 'p-sin-vinculo', tutor_usuario_id: 'tutor-a', nino_id: null }),
          fila({ id: 'p-con-vinculo', tutor_usuario_id: 'tutor-b', nino_id: null }),
          fila({ id: 'p-familia-nueva', tutor_usuario_id: null, nino_id: null }),
        ],
        error: null,
      },
    })
    const service = fakeClient({
      vinculos_familiares: { data: [{ usuario_id: 'tutor-b' }], error: null },
    })

    const r = await getListaEsperaCore(admin.client, 'curso-1', service.client)

    const flag = Object.fromEntries(r.map((p) => [p.id, p.necesita_parentesco]))
    expect(flag).toEqual({
      'p-sin-vinculo': true,
      'p-con-vinculo': false,
      'p-familia-nueva': false,
    })
    // Mismo origen que la acción: vínculos del tutor por `usuario_id`, por el cliente service.
    expect(service.inSpy).toHaveBeenCalledWith('vinculos_familiares', 'usuario_id', [
      'tutor-a',
      'tutor-b',
    ])
    expect(admin.from).not.toHaveBeenCalledWith('vinculos_familiares')
  })

  it('sin tutores guardados no consulta vínculos', async () => {
    const admin = fakeClient({
      lista_espera: {
        data: [fila({ id: 'p-1', tutor_usuario_id: null, nino_id: null })],
        error: null,
      },
    })
    const service = fakeClient({})

    const r = await getListaEsperaCore(admin.client, 'curso-1', service.client)

    expect(r[0]?.necesita_parentesco).toBe(false)
    expect(service.from).not.toHaveBeenCalled()
  })

  it('prospecto ya promovido (con niño) no se marca: ya no ofrece "Invitar"', async () => {
    const admin = fakeClient({
      lista_espera: {
        data: [fila({ id: 'p-1', tutor_usuario_id: 'tutor-a', nino_id: 'nino-1' })],
        error: null,
      },
      matriculas: {
        data: [{ nino_id: 'nino-1', estado: 'pendiente', activada_at: null, fecha_baja: null }],
        error: null,
      },
    })
    const service = fakeClient({ vinculos_familiares: { data: [], error: null } })

    const r = await getListaEsperaCore(admin.client, 'curso-1', service.client)

    expect(r).toHaveLength(1)
    expect(r[0]?.necesita_parentesco).toBe(false)
    expect(service.from).not.toHaveBeenCalled()
  })

  it('si la lectura de vínculos falla, no marca ninguno (el diálogo lo revela si hace falta)', async () => {
    const admin = fakeClient({
      lista_espera: {
        data: [fila({ id: 'p-1', tutor_usuario_id: 'tutor-a', nino_id: null })],
        error: null,
      },
    })
    const service = fakeClient({
      vinculos_familiares: { data: null, error: { message: 'boom' } },
    })

    const r = await getListaEsperaCore(admin.client, 'curso-1', service.client)

    expect(r[0]?.necesita_parentesco).toBe(false)
  })
})
