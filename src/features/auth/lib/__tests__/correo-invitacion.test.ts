import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

/**
 * Censo C (2026-11-25, «¿este arreglo convierte en fallo algo que hoy funciona?»): el correo de una
 * invitación sale DESPUÉS de escribirla. Antes del PR A, si no se podía leer el nombre del centro, el
 * correo salía igual y la plantilla ponía «la escuela». El codemod lo hizo lanzar, y siete acciones
 * (sendInvitation y las que la llaman, crearCentro) contaban como fallida una invitación guardada:
 * quien reintenta, duplica. Vuelve a salir, sin el nombre, y el fallo va a Sentry.
 */

const h = vi.hoisted(() => ({
  invitado: [] as Array<{ email: string; data: Record<string, unknown> }>,
}))
vi.mock('../idioma-invitacion', () => ({ prepararIdiomaInvitacion: async () => 'es' }))
vi.mock('../aviso-invitacion', () => ({ enviarAvisoInvitacion: async () => true }))
vi.mock('../llamar-gotrue', () => ({
  llamarGoTrue: async (_op: string, f: () => Promise<{ error: unknown }>) => {
    const r = await f()
    return { error: r.error, indisponible: false }
  },
}))

const { enviarCorreoInvitacion } = await import('../correo-invitacion')

function service(centro: { data: unknown; error: unknown }): SupabaseClient<Database> {
  return {
    from: (tabla: string) => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) b[m] = () => b
      const r = tabla === 'invitaciones' ? { data: { token: 'tok-1' }, error: null } : centro
      b.single = async () => r
      b.maybeSingle = async () => r
      return b
    },
    auth: {
      admin: {
        inviteUserByEmail: async (email: string, o: { data: Record<string, unknown> }) => {
          h.invitado.push({ email, data: o.data })
          return { error: null }
        },
      },
    },
  } as unknown as SupabaseClient<Database>
}

const DATOS = {
  invitationId: 'inv-1',
  email: 'nueva@nido.test',
  rolObjetivo: 'tutor_legal' as const,
  centroId: 'centro-1',
}

beforeEach(() => {
  h.invitado = []
})

describe('enviarCorreoInvitacion', () => {
  it('premisa: con el centro leído, el correo sale con su nombre', async () => {
    expect(
      await enviarCorreoInvitacion(service({ data: { nombre: 'CEI Demo' }, error: null }), DATOS)
    ).toBeNull()
    expect(h.invitado[0]!.data.centro_nombre).toBe('CEI Demo')
  })

  it('no se puede leer el centro: el correo sale igual, sin el nombre (la plantilla pone «la escuela»)', async () => {
    expect(
      await enviarCorreoInvitacion(service({ data: null, error: { message: 'timeout' } }), DATOS)
    ).toBeNull()
    expect(h.invitado).toHaveLength(1)
    expect(h.invitado[0]!.data.centro_nombre).toBeNull()
  })
})
