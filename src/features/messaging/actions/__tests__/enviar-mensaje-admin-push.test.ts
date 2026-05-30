import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

/**
 * Wiring del push en la rama `admin_familia` de `enviarMensajeCore` (item 5).
 *
 * Mockeamos:
 *  - `enviar-push` → espía `enviarPushANotificarUsuarios` (no enviamos de
 *    verdad; comprobamos a quién se notifica).
 *  - `audiencia.getAutorPushInfo` → datos del autor fijos.
 *    `destinatariosDeAdminFamilia` se deja REAL (es pura).
 *
 * Cliente Supabase falso: `conversaciones`.maybeSingle devuelve la conv del
 * par; `mensajes`.single devuelve el id insertado.
 */

vi.mock('@/features/push/lib/enviar-push', () => ({
  enviarPushANotificarUsuarios: vi.fn(() =>
    Promise.resolve({ enviados: 1, expirados: 0, errores: 0, total: 1 })
  ),
}))

vi.mock('@/features/push/lib/audiencia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/push/lib/audiencia')>()
  return {
    ...actual,
    getAutorPushInfo: vi.fn(() => Promise.resolve({ nombre: 'Autor', idioma: 'es' })),
  }
})

import { enviarPushANotificarUsuarios } from '@/features/push/lib/enviar-push'
import { enviarMensajeCore } from '../enviar-mensaje'

const ADMIN = 'admin-1'
const TUTOR = 'tutor-1'
const CONV = 'conv-1'

function makeSupabase(): SupabaseClient<Database> {
  const conv = {
    id: CONV,
    tipo_conversacion: 'admin_familia',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(), // futuro → no caducada
    admin_id: ADMIN,
    tutor_id: TUTOR,
  }
  return {
    from(table: string) {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.insert = () => b
      b.maybeSingle = () =>
        Promise.resolve({ data: table === 'conversaciones' ? conv : null, error: null })
      b.single = () => Promise.resolve({ data: { id: 'msg-1' }, error: null })
      return b
    },
  } as unknown as SupabaseClient<Database>
}

beforeEach(() => {
  vi.mocked(enviarPushANotificarUsuarios).mockClear()
})

describe('enviarMensajeCore admin_familia → push', () => {
  it('autor admin: notifica al tutor con url a la conversación', async () => {
    const res = await enviarMensajeCore(makeSupabase(), ADMIN, {
      kind: 'admin_familia',
      conversacion_id: CONV,
      contenido: 'hola familia',
    })
    expect(res.success).toBe(true)
    expect(enviarPushANotificarUsuarios).toHaveBeenCalledTimes(1)
    const [destinatarios, payload] = vi.mocked(enviarPushANotificarUsuarios).mock.calls[0]!
    expect(destinatarios).toEqual([TUTOR])
    expect(payload.datos).toMatchObject({ tipo: 'mensaje', conversacion_id: CONV })
    expect(payload.url).toContain('/messages/conversacion/conv-1')
  })

  it('autor tutor: notifica al admin', async () => {
    const res = await enviarMensajeCore(makeSupabase(), TUTOR, {
      kind: 'admin_familia',
      conversacion_id: CONV,
      contenido: 'gracias',
    })
    expect(res.success).toBe(true)
    expect(vi.mocked(enviarPushANotificarUsuarios).mock.calls[0]![0]).toEqual([ADMIN])
  })
})
