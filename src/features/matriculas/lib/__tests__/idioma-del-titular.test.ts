import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/db'

import { idiomaDelTitular } from '../invitar-tutor-2'

/**
 * Censo C (2026-11-25): el idioma del correo al segundo tutor se lee DESPUÉS de cancelar sus
 * invitaciones anteriores (reenviar) o de validar el alta. Su contrato era «si no se puede leer,
 * castellano»; el codemod lo hizo lanzar, y el reenvío contaba como fallido lo ya cancelado. Lo
 * enseñó el escáner de cadena al abrir TODAS las paradas de cada función, no solo la primera.
 */
function service(r: { data: unknown; error: unknown }) {
  return {
    from: () => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) b[m] = () => b
      b.maybeSingle = async () => r
      return b
    },
  } as unknown as SupabaseClient<Database>
}
const TUTORES = [{ tipo_vinculo: 'tutor_legal_principal', usuario_id: 'u-1' }]

describe('idiomaDelTitular', () => {
  it('premisa: el del tutor principal', async () => {
    expect(
      await idiomaDelTitular(service({ data: { idioma_preferido: 'va' }, error: null }), TUTORES)
    ).toBe('va')
  })

  it('no se puede leer: castellano, sin lanzar', async () => {
    expect(
      await idiomaDelTitular(service({ data: null, error: { message: 'timeout' } }), TUTORES)
    ).toBe('es')
  })
})
