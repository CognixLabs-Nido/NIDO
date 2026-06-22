import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests del motor de push. La estrategia es mockear `web-push` y el cliente
 * service-role de Supabase y reimportar el módulo bajo prueba con
 * `vi.resetModules()` entre tests para evitar fugas del estado de
 * `vapidConfigured` (variable a nivel módulo).
 */

interface FakeSubscription {
  id: string
  usuario_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  created_at: string
  updated_at: string
  last_active_at: string
}

const SUB_OK: FakeSubscription = {
  id: 'sub-ok',
  usuario_id: 'user-1',
  endpoint: 'https://fcm.googleapis.com/fcm/send/ok',
  p256dh: 'p256dh-ok',
  auth: 'auth-ok',
  user_agent: null,
  created_at: '2026-05-27T00:00:00Z',
  updated_at: '2026-05-27T00:00:00Z',
  last_active_at: '2026-05-27T00:00:00Z',
}

const SUB_410: FakeSubscription = { ...SUB_OK, id: 'sub-410', endpoint: 'https://gone.example/410' }
const SUB_404: FakeSubscription = { ...SUB_OK, id: 'sub-404', endpoint: 'https://gone.example/404' }
const SUB_500: FakeSubscription = { ...SUB_OK, id: 'sub-500', endpoint: 'https://err.example/500' }

interface DeleteCall {
  ids: string[]
}

function setupMocks(opts: {
  subs: FakeSubscription[]
  selectError?: { message: string } | null
  deleteError?: { message: string } | null
}) {
  const deleteCalls: DeleteCall[] = []
  const setVapidDetails = vi.fn()
  const sendNotification = vi.fn(
    async (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, _payload: string) => {
      if (sub.endpoint === SUB_410.endpoint) {
        const err = new Error('Gone') as Error & { statusCode: number }
        err.statusCode = 410
        throw err
      }
      if (sub.endpoint === SUB_404.endpoint) {
        const err = new Error('Not found') as Error & { statusCode: number }
        err.statusCode = 404
        throw err
      }
      if (sub.endpoint === SUB_500.endpoint) {
        const err = new Error('Server error') as Error & { statusCode: number }
        err.statusCode = 500
        throw err
      }
      return { statusCode: 201 }
    }
  )

  vi.doMock('web-push', () => ({
    default: { setVapidDetails, sendNotification },
    setVapidDetails,
    sendNotification,
  }))

  vi.doMock('@/lib/supabase/admin', () => ({
    createServiceRoleClient: vi.fn(() => ({
      from: (_table: string) => ({
        select: () => ({
          in: () => Promise.resolve({ data: opts.subs, error: opts.selectError ?? null }),
        }),
        delete: () => ({
          in: (_col: string, ids: string[]) => {
            deleteCalls.push({ ids })
            return Promise.resolve({ error: opts.deleteError ?? null })
          },
        }),
      }),
    })),
  }))

  return { deleteCalls, setVapidDetails, sendNotification }
}

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env.VAPID_PUBLIC_KEY = 'public-key-test'
  process.env.VAPID_PRIVATE_KEY = 'private-key-test'
  process.env.VAPID_SUBJECT = 'mailto:test@example.com'
})

afterEach(() => {
  vi.doUnmock('web-push')
  vi.doUnmock('@/lib/supabase/admin')
  vi.unstubAllEnvs()
  process.env.VAPID_PUBLIC_KEY = ORIG_ENV.VAPID_PUBLIC_KEY
  process.env.VAPID_PRIVATE_KEY = ORIG_ENV.VAPID_PRIVATE_KEY
  process.env.VAPID_SUBJECT = ORIG_ENV.VAPID_SUBJECT
})

describe('enviarPushANotificarUsuarios', () => {
  it('devuelve ceros y no consulta BD si la audiencia es vacía', async () => {
    const mocks = setupMocks({ subs: [] })
    const { enviarPushANotificarUsuarios } = await import('../enviar-push')
    const res = await enviarPushANotificarUsuarios([], {
      titulo: 'T',
      cuerpo: 'C',
      url: '/x',
    })
    expect(res).toEqual({ enviados: 0, expirados: 0, errores: 0, total: 0 })
    expect(mocks.sendNotification).not.toHaveBeenCalled()
    expect(mocks.setVapidDetails).not.toHaveBeenCalled()
  })

  it('early return si faltan VAPID keys (no rompe al caller)', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    delete process.env.VAPID_SUBJECT
    const mocks = setupMocks({ subs: [SUB_OK] })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { enviarPushANotificarUsuarios } = await import('../enviar-push')
    const res = await enviarPushANotificarUsuarios(['user-1'], {
      titulo: 'T',
      cuerpo: 'C',
      url: '/x',
    })
    expect(res).toEqual({ enviados: 0, expirados: 0, errores: 0, total: 0 })
    expect(mocks.sendNotification).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('envía a una suscripción válida y cuenta como enviado', async () => {
    const mocks = setupMocks({ subs: [SUB_OK] })
    const { enviarPushANotificarUsuarios } = await import('../enviar-push')
    const res = await enviarPushANotificarUsuarios(['user-1'], {
      titulo: 'Profe',
      cuerpo: 'Hola',
      url: '/es/messages?nino=abc',
    })
    expect(res).toEqual({ enviados: 1, expirados: 0, errores: 0, total: 1 })
    expect(mocks.setVapidDetails).toHaveBeenCalledTimes(1)
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1)
    const [subArg, payloadArg] = mocks.sendNotification.mock.calls[0] as [
      { endpoint: string; keys: { p256dh: string; auth: string } },
      string,
    ]
    expect(subArg.endpoint).toBe(SUB_OK.endpoint)
    expect(subArg.keys.p256dh).toBe(SUB_OK.p256dh)
    expect(subArg.keys.auth).toBe(SUB_OK.auth)
    const payload = JSON.parse(payloadArg)
    expect(payload).toEqual({
      titulo: 'Profe',
      cuerpo: 'Hola',
      url: '/es/messages?nino=abc',
    })
    expect(mocks.deleteCalls).toEqual([])
  })

  it('borra la suscripción al recibir 410 Gone', async () => {
    const mocks = setupMocks({ subs: [SUB_OK, SUB_410] })
    const { enviarPushANotificarUsuarios } = await import('../enviar-push')
    const res = await enviarPushANotificarUsuarios(['user-1'], {
      titulo: 'T',
      cuerpo: 'C',
      url: '/x',
    })
    expect(res).toEqual({ enviados: 1, expirados: 1, errores: 0, total: 2 })
    expect(mocks.deleteCalls).toHaveLength(1)
    expect(mocks.deleteCalls[0]?.ids).toEqual(['sub-410'])
  })

  it('borra la suscripción al recibir 404 Not Found', async () => {
    const mocks = setupMocks({ subs: [SUB_404] })
    const { enviarPushANotificarUsuarios } = await import('../enviar-push')
    const res = await enviarPushANotificarUsuarios(['user-1'], {
      titulo: 'T',
      cuerpo: 'C',
      url: '/x',
    })
    expect(res).toEqual({ enviados: 0, expirados: 1, errores: 0, total: 1 })
    expect(mocks.deleteCalls[0]?.ids).toEqual(['sub-404'])
  })

  it('cuenta error 500 como error y NO borra la suscripción', async () => {
    const mocks = setupMocks({ subs: [SUB_500] })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { enviarPushANotificarUsuarios } = await import('../enviar-push')
    const res = await enviarPushANotificarUsuarios(['user-1'], {
      titulo: 'T',
      cuerpo: 'C',
      url: '/x',
    })
    expect(res).toEqual({ enviados: 0, expirados: 0, errores: 1, total: 1 })
    expect(mocks.deleteCalls).toEqual([])
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('devuelve ceros si no hay suscripciones de los usuarios objetivo', async () => {
    const mocks = setupMocks({ subs: [] })
    const { enviarPushANotificarUsuarios } = await import('../enviar-push')
    const res = await enviarPushANotificarUsuarios(['user-sin-subs'], {
      titulo: 'T',
      cuerpo: 'C',
      url: '/x',
    })
    expect(res).toEqual({ enviados: 0, expirados: 0, errores: 0, total: 0 })
    expect(mocks.sendNotification).not.toHaveBeenCalled()
  })

  it('si la query a BD falla, devuelve ceros y log de error', async () => {
    const mocks = setupMocks({
      subs: [],
      selectError: { message: 'connection lost' },
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { enviarPushANotificarUsuarios } = await import('../enviar-push')
    const res = await enviarPushANotificarUsuarios(['user-1'], {
      titulo: 'T',
      cuerpo: 'C',
      url: '/x',
    })
    expect(res).toEqual({ enviados: 0, expirados: 0, errores: 0, total: 0 })
    expect(mocks.sendNotification).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('mezcla ok + 410 + 500: cuenta cada estado y borra solo el 410', async () => {
    const mocks = setupMocks({ subs: [SUB_OK, SUB_410, SUB_500] })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { enviarPushANotificarUsuarios } = await import('../enviar-push')
    const res = await enviarPushANotificarUsuarios(['user-1'], {
      titulo: 'T',
      cuerpo: 'C',
      url: '/x',
    })
    expect(res).toEqual({ enviados: 1, expirados: 1, errores: 1, total: 3 })
    expect(mocks.deleteCalls).toHaveLength(1)
    expect(mocks.deleteCalls[0]?.ids).toEqual(['sub-410'])
    errSpy.mockRestore()
  })
})
