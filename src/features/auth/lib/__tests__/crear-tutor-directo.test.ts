import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { crearTutorDirecto } from '../crear-tutor-directo'

/**
 * PR 1 (Fase 4) — «Completar en Dirección» reutiliza la cuenta a medias de un intento anterior
 * (`stub`) y le fija una contraseña. Una cuenta sin roles vivos que YA operó (el superusuario,
 * quien perdió su rol) no es una cuenta a medias: no se le toca la contraseña.
 */

let operada: boolean | null
const updateUserById = vi.fn(async () => ({ data: { user: { id: 'cuenta-1' } }, error: null }))

function service(): SupabaseClient<Database> {
  return {
    rpc: (name: string) => {
      if (name === 'buscar_auth_user_por_email')
        return { maybeSingle: async () => ({ data: { id: 'cuenta-1' }, error: null }) }
      if (name === 'cuenta_ha_operado')
        return Promise.resolve(
          operada === null
            ? { data: null, error: { message: 'boom' } }
            : { data: operada, error: null }
        )
      return Promise.resolve({ data: null, error: null })
    },
    from: () => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'limit', 'update']) b[m] = () => b
      b.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null })
      return b
    },
    auth: { admin: { updateUserById } },
  } as unknown as SupabaseClient<Database>
}

const PARAMS = {
  email: 'persona@nido.test',
  password: 'Aa1!aleatoria',
  nombreCompleto: 'Persona Demo',
  idiomaPreferido: 'es' as const,
}

beforeEach(() => {
  updateUserById.mockClear()
})

describe('crearTutorDirecto — cuenta sin roles vivos', () => {
  it('nunca operó (alta a medias): se reutiliza y se le fija la contraseña', async () => {
    operada = false
    const r = await crearTutorDirecto(service(), PARAMS)
    expect(r).toEqual({ success: true, data: { usuarioId: 'cuenta-1' } })
    expect(updateUserById).toHaveBeenCalledTimes(1)
  })

  it('ya operó (superusuario, rol retirado): no se le toca la contraseña', async () => {
    operada = true
    const r = await crearTutorDirecto(service(), PARAMS)
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.email_already_registered' })
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('no se puede saber: no sigue', async () => {
    operada = null
    const r = await crearTutorDirecto(service(), PARAMS)
    expect(r).toEqual({
      success: false,
      error: 'auth.invitation.errors.servicio_cuentas_no_disponible',
    })
    expect(updateUserById).not.toHaveBeenCalled()
  })
})
