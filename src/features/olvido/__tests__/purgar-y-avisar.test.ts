// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

/**
 * El correo de «borrada» (spec, «Avisos»): se redacta antes de purgar, mientras aún se conoce la
 * dirección, y sale solo si la purga terminó. Si la purga falla, la solicitud se reintenta mañana
 * y el correo no puede haber salido ya.
 */

const h = vi.hoisted(() => ({ orden: [] as string[], enviados: [] as unknown[] }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/shared/lib/adjuntos/storage', () => ({ borrarObjetosBucket: vi.fn() }))
vi.mock('../lib/avisar', () => ({
  prepararAvisoFamilia: vi.fn(async (_s: unknown, id: string, evento: string) => {
    h.orden.push(`preparar:${evento}`)
    return [{ para: 'tutor@example.test', asunto: 'a', texto: id, html: '' }]
  }),
  enviarAvisos: vi.fn(async (correos: unknown[]) => {
    h.orden.push('enviar')
    h.enviados.push(...correos)
    return correos.length
  }),
}))

const { purgarYAvisar } = await import('../actions/purgar-vencidos')

const service = {} as SupabaseClient<Database>
const pendiente = {
  solicitud_id: 'sol-1',
  sujeto_tipo: 'nino',
  sujeto_id: 'n-1',
  centro_id: 'c-1',
} as Parameters<typeof purgarYAvisar>[1]

beforeEach(() => {
  h.orden = []
  h.enviados = []
})

describe('purgarYAvisar', () => {
  it('redacta antes de purgar y envía después', async () => {
    await purgarYAvisar(service, pendiente, async () => {
      h.orden.push('purgar')
    })
    expect(h.orden).toEqual(['preparar:borrada', 'purgar', 'enviar'])
    expect(h.enviados).toHaveLength(1)
  })

  it('si la purga falla, no sale ningún correo y el error llega al bucle', async () => {
    await expect(
      purgarYAvisar(service, pendiente, async () => {
        h.orden.push('purgar')
        throw new Error('storage caído')
      })
    ).rejects.toThrow('storage caído')
    // Premisa: se llegó a purgar con el correo ya redactado.
    expect(h.orden).toEqual(['preparar:borrada', 'purgar'])
    expect(h.enviados).toHaveLength(0)
  })
})
