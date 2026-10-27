// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PushPayload } from '@/features/push/types'
import type { Database } from '@/types/database'

/**
 * Los avisos de las peticiones de olvido (spec, «Avisos»): la push a la titular es genérica, sin
 * nombres; el correo va a quien devuelve `olvido_destinatarios`, en su idioma, y solo nombra el
 * centro. Con las traducciones reales.
 */

const h = vi.hoisted(() => ({
  correos: [] as { para: string; asunto: string; texto: string }[],
  push: [] as { ids: string[]; payload: PushPayload }[],
}))

vi.mock('server-only', () => ({}))
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl')
  const mensajes: Record<string, Record<string, unknown>> = {
    es: (await import('@/../messages/es.json')).default,
    va: (await import('@/../messages/va.json')).default,
  }
  return {
    getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
      createTranslator({ locale, messages: mensajes[locale]!, namespace } as never),
  }
})
vi.mock('@/shared/lib/correo/enviar-correo', () => ({
  enviarCorreo: vi.fn(async (c: { para: string; asunto: string; texto: string }) => {
    h.correos.push(c)
    return { enviado: true }
  }),
}))
vi.mock('@/features/push/lib/audiencia', () => ({
  idiomasDeUsuarios: vi.fn(
    async (ids: string[]) => new Map(ids.map((id) => [id, id === 'u-va' ? 'va' : 'es']))
  ),
}))
vi.mock('@/features/push/lib/enviar-por-idioma', () => ({
  enviarPushPorIdioma: vi.fn(
    async (ids: string[], construir: (i: string) => Promise<PushPayload>) => {
      h.push.push({ ids, payload: await construir('es') })
      return { enviados: ids.length, expirados: 0, errores: 0, total: ids.length }
    }
  ),
}))
vi.mock('@/shared/lib/app-url', () => ({ getAppUrl: () => 'https://nido.test' }))

const { avisarFamilia, avisarTitular } = await import('../lib/avisar')

function service(): SupabaseClient<Database> {
  return {
    rpc: async () => ({ data: [{ usuario_id: 'u-es' }, { usuario_id: 'u-va' }], error: null }),
    from(tabla: string) {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is']) b[m] = () => b
      b.maybeSingle = async () => ({
        data:
          tabla === 'olvido_solicitudes'
            ? { centro_id: 'c-1' }
            : tabla === 'centros'
              ? { nombre: 'CEI Ejemplo' }
              : null,
        error: null,
      })
      // roles_usuario: la lista de titulares.
      b.then = (r: (v: unknown) => void) => r({ data: [{ usuario_id: 'tit-1' }], error: null })
      return b
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { email: `${id}@example.test` } } }),
      },
    },
  } as unknown as SupabaseClient<Database>
}

beforeEach(() => {
  h.correos = []
  h.push = []
})

describe('avisarFamilia', () => {
  it('un correo a cada destinatario, en su idioma, que nombra el centro y lleva al perfil', async () => {
    const n = await avisarFamilia(service(), 'sol-1', 'rechazada')
    expect(n).toBe(2)
    expect(h.correos.map((c) => c.para)).toEqual(['u-es@example.test', 'u-va@example.test'])
    expect(h.correos[0]!.texto).toContain(
      'CEI Ejemplo ha rechazado la petición de borrado de datos'
    )
    expect(h.correos[0]!.texto).toContain('https://nido.test/es/profile')
    expect(h.correos[1]!.texto).toContain("CEI Ejemplo ha rebutjat la petició d'esborrat de dades")
    expect(h.correos[1]!.texto).toContain('https://nido.test/va/profile')
  })
})

describe('avisarTitular', () => {
  it('push genérica a la titular, sin nombres, que abre la página de peticiones', async () => {
    await avisarTitular(service(), 'c-1')
    // Premisa: la push salió.
    expect(h.push).toHaveLength(1)
    expect(h.push[0]!.ids).toEqual(['tit-1'])
    expect(h.push[0]!.payload).toMatchObject({
      titulo: 'Petición de borrado de datos',
      cuerpo: 'Tienes una petición nueva por revisar',
      url: '/es/admin/olvido?centro=c-1',
    })
  })
})
