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
 *
 * Multicentro: el enlace de la notificación lleva el centro del registro (`?centro=`), el de la
 * conversación o el del niño, para que la página ofrezca cambiar si es otro centro del usuario.
 *
 * Idioma: el enlace va en el idioma de QUIEN RECIBE (`idiomasDeUsuarios`), no en el del autor.
 * Cada destinatario tiene aquí un idioma distinto del castellano por defecto.
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
    getAutorPushInfo: vi.fn(() => Promise.resolve({ nombre: 'Autor' })),
    destinatariosDeNino: vi.fn(() => Promise.resolve(['tutor-del-nino'])),
    idiomasDeUsuarios: vi.fn(async () => IDIOMAS),
  }
})

import { enviarPushANotificarUsuarios } from '@/features/push/lib/enviar-push'
import { enviarMensajeCore } from '../enviar-mensaje'

const ADMIN = 'admin-1'
const TUTOR = 'tutor-1'
const CONV = 'conv-1'
// Cada uno en un idioma; el autor no tiene ninguno que valga para ellos.
const IDIOMAS = vi.hoisted(
  () =>
    new Map([
      ['tutor-1', 'va'],
      ['admin-1', 'en'],
      ['tutor-del-nino', 'va'],
    ])
)
const CENTRO_CONV = 'centro-de-la-conv'
const CENTRO_NINO = 'centro-del-nino'
const NINO = '00000000-0000-4000-8000-000000000001'

function makeSupabase(): SupabaseClient<Database> {
  const conv = {
    id: CONV,
    centro_id: CENTRO_CONV,
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
        Promise.resolve({
          data:
            table === 'conversaciones'
              ? conv
              : table === 'ninos'
                ? { centro_id: CENTRO_NINO }
                : null,
          error: null,
        })
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
    expect(payload.url).toBe(`/va/messages/conversacion/conv-1?centro=${CENTRO_CONV}`)
  })

  it('autor tutor: notifica al admin', async () => {
    const res = await enviarMensajeCore(makeSupabase(), TUTOR, {
      kind: 'admin_familia',
      conversacion_id: CONV,
      contenido: 'gracias',
    })
    expect(res.success).toBe(true)
    const [destinatarios, payload] = vi.mocked(enviarPushANotificarUsuarios).mock.calls[0]!
    expect(destinatarios).toEqual([ADMIN])
    // El admin tiene la app en inglés: su enlace, en inglés.
    expect(payload.url).toBe(`/en/messages/conversacion/conv-1?centro=${CENTRO_CONV}`)
  })
})

describe('enviarMensajeCore profe_familia → push', () => {
  it('el enlace abre el niño y lleva el centro del niño', async () => {
    const res = await enviarMensajeCore(makeSupabase(), 'profe-1', {
      kind: 'profe_familia',
      nino_id: NINO,
      contenido: 'hoy ha comido bien',
    })
    expect(res.success).toBe(true)
    const [destinatarios, payload] = vi.mocked(enviarPushANotificarUsuarios).mock.calls[0]!
    expect(destinatarios).toEqual(['tutor-del-nino'])
    expect(payload.url).toBe(`/va/messages?nino=${NINO}&centro=${CENTRO_NINO}`)
  })
})
