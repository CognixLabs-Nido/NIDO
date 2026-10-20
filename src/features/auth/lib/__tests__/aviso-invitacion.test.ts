import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

const h = vi.hoisted(() => ({
  enviados: [] as Array<{ para: string; asunto: string; texto: string; html: string }>,
  sale: true,
}))
vi.mock('@/shared/lib/correo/enviar-correo', () => ({
  enviarCorreo: async (c: { para: string; asunto: string; texto: string; html: string }) => {
    h.enviados.push(c)
    return h.sale ? { enviado: true } : { enviado: false, motivo: 'fallo' }
  },
}))
vi.mock('next-intl/server', () => ({
  getTranslations:
    async ({ locale }: { locale: string }) =>
    (k: string, v?: Record<string, string>) =>
      `${locale}:${k}${v?.centro ? `(${v.centro})` : ''}`,
}))

const { enviarAvisoInvitacion } = await import('../aviso-invitacion')

/**
 * PR 1 (Fase 4) — el aviso de invitación a una cuenta que ya existe: en el idioma de la cuenta,
 * lleva a `/profile/invitations` (sin token) y solo nombra el centro.
 */

/** Service falso: la cuenta del email y su idioma. */
function service(idioma: string | null): SupabaseClient<Database> {
  return {
    rpc: () => ({ maybeSingle: async () => ({ data: { id: 'cuenta-1' }, error: null }) }),
    from: () => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) b[m] = () => b
      b.maybeSingle = async () => ({
        data: idioma === null ? null : { idioma_preferido: idioma },
        error: null,
      })
      return b
    },
  } as unknown as SupabaseClient<Database>
}

beforeEach(() => {
  h.enviados = []
  h.sale = true
})

describe('enviarAvisoInvitacion', () => {
  it('sale en el idioma de la cuenta y lleva a sus invitaciones, sin token', async () => {
    const ok = await enviarAvisoInvitacion(service('va'), {
      email: 'persona@nido.test',
      centroNombre: 'Escoleta Demo',
    })

    expect(ok).toBe(true)
    const [c] = h.enviados
    expect(c!.para).toBe('persona@nido.test')
    expect(c!.asunto).toBe('va:asunto')
    expect(c!.texto).toContain('va:intro_centro(Escoleta Demo)')
    expect(c!.texto).toContain('http://localhost:3000/va/profile/invitations')
    expect(c!.html).toContain('href="http://localhost:3000/va/profile/invitations"')
    expect(c!.texto).not.toMatch(/invitation\/[0-9a-f-]{36}/)
  })

  it('sin idioma en la cuenta, castellano; sin centro, el texto genérico', async () => {
    await enviarAvisoInvitacion(service(null), { email: 'persona@nido.test', centroNombre: null })

    expect(h.enviados[0]!.asunto).toBe('es:asunto')
    expect(h.enviados[0]!.texto).toContain('es:intro_sin_centro')
  })

  it('el nombre del centro se escapa en el HTML', async () => {
    await enviarAvisoInvitacion(service('es'), {
      email: 'persona@nido.test',
      centroNombre: '<img src=x onerror=alert(1)>',
    })

    expect(h.enviados[0]!.html).not.toContain('<img')
    expect(h.enviados[0]!.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('si no sale, lo dice', async () => {
    h.sale = false
    expect(
      await enviarAvisoInvitacion(service('es'), { email: 'persona@nido.test', centroNombre: null })
    ).toBe(false)
  })
})
