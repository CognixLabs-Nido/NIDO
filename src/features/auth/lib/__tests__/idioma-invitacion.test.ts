import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

vi.mock('../llamar-gotrue', () => ({
  llamarGoTrue: async (_op: string, f: () => Promise<unknown>) => f(),
}))

const { prepararIdiomaInvitacion } = await import('../idioma-invitacion')

/**
 * Censo C (2026-11-25): el idioma se prepara DESPUÉS de escribir la invitación, y su propio contrato
 * es «nunca falla la invitación: si algo de esto falla, se registra y el correo sale igualmente». El
 * codemod hizo lanzar la lectura del idioma de la cuenta provisional; vuelve a no parar.
 */
function service(lecturaIdioma: { data: unknown; error: unknown }) {
  const actualizados: unknown[] = []
  const s = {
    rpc: () => ({ maybeSingle: async () => ({ data: { id: 'cuenta-1' }, error: null }) }),
    from: () => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) b[m] = () => b
      b.maybeSingle = async () => lecturaIdioma
      b.update = (p: unknown) => {
        actualizados.push(p)
        return b
      }
      b.then = (r: (v: unknown) => unknown) => r({ error: null })
      return b
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email_confirmed_at: null } }, error: null }),
        updateUserById: async () => ({ error: null }),
      },
    },
  } as unknown as SupabaseClient<Database>
  return { s, actualizados }
}

describe('prepararIdiomaInvitacion', () => {
  it('premisa: cuenta provisional en va y la Dirección elige en: se cambia a en', async () => {
    const { s, actualizados } = service({ data: { idioma_preferido: 'va' }, error: null })
    expect(await prepararIdiomaInvitacion(s, 'p@nido.test', 'en')).toBe('en')
    expect(actualizados).toEqual([{ idioma_preferido: 'en' }])
  })

  // Lo que hacía antes del codemod (medido contra 7ee2022d): sin el idioma leído, `actual` era 'es' y,
  // con otro elegido, se actualizaba la cuenta provisional. Eso hace falta: GoTrue reenvía con los
  // metadatos de la cuenta, y sin actualizarlos el correo saldría en el idioma viejo.
  it('no se puede leer el idioma de la cuenta: no para, y la cuenta provisional pasa al elegido', async () => {
    const { s, actualizados } = service({ data: null, error: { message: 'timeout' } })
    expect(await prepararIdiomaInvitacion(s, 'p@nido.test', 'en')).toBe('en')
    expect(actualizados).toEqual([{ idioma_preferido: 'en' }])
  })
})
