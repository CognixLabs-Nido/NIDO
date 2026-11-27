// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

/**
 * Censo C (B1, 2026-11-26): el correo a la familia por un cambio de su petición de olvido, con una lectura
 * caída. El cambio ya está hecho y la función «nunca lanza». Antes: sin destinatarios, un `warn` y ningún
 * correo; sin la solicitud o el centro, el correo sin el nombre del centro, sin que nadie lo supiera. Ahora
 * el correo sale igual cuando se puede, y cada fallo va a Sentry (`lecturaFallidaTrasEscritura`). Fixtures
 * ficticios.
 */
vi.mock('server-only', () => ({}))
const { estado, logError } = vi.hoisted(() => ({
  estado: { falla: null as string | null },
  logError: vi.fn(),
}))
vi.mock('@/shared/lib/logger', () => ({
  logger: { error: logError, warn: vi.fn(), info: vi.fn() },
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (k: string, v?: Record<string, string>) =>
    v?.centro !== undefined ? `${k}[${v.centro}]` : k,
}))
vi.mock('@/features/push/lib/audiencia', () => ({ idiomasDeUsuarios: async () => new Map() }))
vi.mock('@/shared/lib/app-url', () => ({ getAppUrl: () => 'https://nido.example' }))

const CAIDA = { data: null, error: { code: 'XX000', message: 'caída' } }
const service = {
  rpc: async () =>
    estado.falla === 'olvido_destinatarios'
      ? CAIDA
      : { data: [{ usuario_id: 'u-1' }], error: null },
  from: (tabla: string) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) c[m] = () => c
    c.maybeSingle = async () =>
      estado.falla === tabla
        ? CAIDA
        : {
            data: tabla === 'centros' ? { nombre: 'CEI Ejemplo' } : { centro_id: 'c-1' },
            error: null,
          }
    return c
  },
  auth: {
    admin: { getUserById: async () => ({ data: { user: { email: 'tutor@example.test' } } }) },
  },
} as unknown as SupabaseClient<Database>

const { prepararAvisoFamilia } = await import('../avisar')
const avisos = () => prepararAvisoFamilia(service, 'sol-1', 'confirmada')
const enSentry = () => logError.mock.calls.map((c) => String(c[0]))

beforeEach(() => {
  estado.falla = null
  logError.mockClear()
})

describe('prepararAvisoFamilia', () => {
  it('premisa: con todo leído, el correo lleva el nombre del centro y nada va a Sentry', async () => {
    const [c] = await avisos()
    expect(c?.texto).toContain('[CEI Ejemplo]')
    expect(enSentry()).toEqual([])
  })

  it('sin destinatarios: ningún correo, y va a Sentry', async () => {
    estado.falla = 'olvido_destinatarios'
    expect(await avisos()).toEqual([])
    expect(enSentry()).toContainEqual(expect.stringContaining('destinatarios del aviso'))
  })

  it.each([
    ['olvido_solicitudes', 'solicitud del aviso'],
    ['centros', 'centro del aviso'],
  ])('sin %s: el correo sale sin el centro, y va a Sentry', async (tabla, donde) => {
    estado.falla = tabla
    const [c] = await avisos()
    expect(c?.para).toBe('tutor@example.test')
    expect(c?.texto).toContain('[]')
    expect(enSentry()).toContainEqual(expect.stringContaining(donde))
  })
})
