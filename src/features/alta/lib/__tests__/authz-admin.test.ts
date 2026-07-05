import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { esAdminDeCentroDeNino } from '../authz-tutor'

/**
 * PR-3b-2 · B2 — tests de aislamiento de `esAdminDeCentroDeNino`, la primitiva que TODOS
 * los write-paths del modo "Completa Dirección" re-derivan server-side (gate de niño/libro,
 * firma admin, acuse médico, mandato SEPA). Verifica el límite de seguridad "¿es admin del
 * CENTRO DEL NIÑO?" sin BD, con un cliente Supabase falso por-tabla:
 *  - `ninos.select('centro_id')` → centro del niño (o null si no lo ve por RLS),
 *  - `roles_usuario` filtrado por (usuario, centro DEL NIÑO, rol='admin') → filas.
 *
 * Casos clave (aislamiento):
 *  - admin del centro del niño → true.
 *  - admin de OTRO centro → sin rol admin en el centro del niño → [] → false.
 *  - profe / usuario sin rol admin → false.
 *  - usuario sin acceso al niño (RLS oculta `ninos`) → centro null → false (sin 2.ª query).
 */

const NINO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const USUARIO = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'

interface Resp {
  data: unknown
  error: unknown
}

/** Fake que responde por tabla: `ninos` (maybeSingle) y `roles_usuario` (lista). */
function makeFake(ninoResp: Resp, rolesResp: Resp) {
  function builder(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    b.select = () => b
    b.eq = () => b
    b.is = () => b
    b.limit = () => b
    b.maybeSingle = () => b
    b.then = (resolve: (v: Resp) => unknown) => resolve(table === 'ninos' ? ninoResp : rolesResp)
    return b
  }
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient<Database>
}

describe('esAdminDeCentroDeNino (primitiva de seguridad B2)', () => {
  it('admin del centro del niño → true', async () => {
    const fake = makeFake(
      { data: { centro_id: 'C1' }, error: null },
      { data: [{ rol: 'admin' }], error: null }
    )
    expect(await esAdminDeCentroDeNino(fake, NINO, USUARIO)).toBe(true)
  })

  it('admin de OTRO centro (sin rol admin en el centro del niño) → false', async () => {
    // La query de roles filtra por el centro DEL NIÑO: un admin de otro centro no tiene fila.
    const fake = makeFake({ data: { centro_id: 'C1' }, error: null }, { data: [], error: null })
    expect(await esAdminDeCentroDeNino(fake, NINO, USUARIO)).toBe(false)
  })

  it('profe / usuario sin rol admin en el centro del niño → false', async () => {
    const fake = makeFake({ data: { centro_id: 'C1' }, error: null }, { data: [], error: null })
    expect(await esAdminDeCentroDeNino(fake, NINO, USUARIO)).toBe(false)
  })

  it('usuario sin acceso al niño (RLS oculta `ninos`) → false', async () => {
    const fake = makeFake({ data: null, error: null }, { data: [{ rol: 'admin' }], error: null })
    expect(await esAdminDeCentroDeNino(fake, NINO, USUARIO)).toBe(false)
  })

  it('niño sin centro_id → false', async () => {
    const fake = makeFake({ data: { centro_id: null }, error: null }, { data: [], error: null })
    expect(await esAdminDeCentroDeNino(fake, NINO, USUARIO)).toBe(false)
  })
})
