import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/db'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

import { esAdminDeCentroDeNino, esTutorLegalDe } from '../authz-tutor'

/**
 * PR-3b-2 · B2 — tests de aislamiento de `esAdminDeCentroDeNino`, la primitiva que TODOS
 * los write-paths del modo "Completa Dirección" re-derivan server-side (gate de niño/libro,
 * firma admin, acuse médico, mandato SEPA). Verifica el límite de seguridad "¿es admin del
 * CENTRO DEL NIÑO?" sin BD, con un cliente Supabase falso por-tabla:
 *  - `ninos.select('centro_id')` → centro del niño (o null si no lo ve por RLS),
 *  - `roles_usuario` del usuario → TODAS sus filas (centro_id, rol), como las devuelve la BD; el
 *    filtro por el centro DEL NIÑO lo hace `esAdminEn` en código (multicentro · Fase 1).
 *
 * Casos clave (aislamiento):
 *  - admin del centro del niño → true.
 *  - admin de OTRO centro → su fila admin es de C2, no del centro del niño → false.
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
  return {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: false, error: null }),
  } as unknown as SupabaseClient<Database>
}

describe('esAdminDeCentroDeNino (primitiva de seguridad B2)', () => {
  it('admin del centro del niño → true', async () => {
    const fake = makeFake(
      { data: { centro_id: 'C1' }, error: null },
      { data: [{ centro_id: 'C1', rol: 'admin' }], error: null }
    )
    expect(await esAdminDeCentroDeNino(fake, NINO, USUARIO)).toBe(true)
  })

  it('admin de OTRO centro (sin rol admin en el centro del niño) → false', async () => {
    // Admin en C2 y tutor en C1: la fila admin existe, pero no es del centro del niño.
    const fake = makeFake(
      { data: { centro_id: 'C1' }, error: null },
      {
        data: [
          { centro_id: 'C2', rol: 'admin' },
          { centro_id: 'C1', rol: 'tutor_legal' },
        ],
        error: null,
      }
    )
    expect(await esAdminDeCentroDeNino(fake, NINO, USUARIO)).toBe(false)
  })

  it('profe / usuario sin rol admin en el centro del niño → false', async () => {
    const fake = makeFake(
      { data: { centro_id: 'C1' }, error: null },
      { data: [{ centro_id: 'C1', rol: 'profe' }], error: null }
    )
    expect(await esAdminDeCentroDeNino(fake, NINO, USUARIO)).toBe(false)
  })

  it('usuario sin acceso al niño (RLS oculta `ninos`) → false', async () => {
    const fake = makeFake(
      { data: null, error: null },
      { data: [{ centro_id: 'C1', rol: 'admin' }], error: null }
    )
    expect(await esAdminDeCentroDeNino(fake, NINO, USUARIO)).toBe(false)
  })

  it('niño sin centro_id → false', async () => {
    const fake = makeFake({ data: { centro_id: null }, error: null }, { data: [], error: null })
    expect(await esAdminDeCentroDeNino(fake, NINO, USUARIO)).toBe(false)
  })
})

/**
 * Censo C (B1, 2026-11-26): con la lectura caída, las dos primitivas daban `false` y quien las llama decía
 * «no autorizado» a quien sí lo es. Ahora lanzan `LecturaFallida`. Premisa: con la lectura bien, `true`.
 */
describe('censo C: la lectura caída no es «no autorizado»', () => {
  const CAIDA = { data: null, error: { code: 'XX000', message: 'caída' } }
  async function lanza(p: Promise<unknown>) {
    const e = await p.then(
      () => null,
      (err: unknown) => err
    )
    expect(esLecturaFallida(e), `esperaba una LecturaFallida, llegó ${String(e)}`).toBe(true)
  }

  it('esAdminDeCentroDeNino: premisa true; con ninos caída, lanza', async () => {
    const roles = { data: [{ centro_id: 'C1', rol: 'admin' }], error: null }
    expect(
      await esAdminDeCentroDeNino(
        makeFake({ data: { centro_id: 'C1' }, error: null }, roles),
        NINO,
        USUARIO
      )
    ).toBe(true)
    await lanza(esAdminDeCentroDeNino(makeFake(CAIDA, roles), NINO, USUARIO))
  })

  it('esTutorLegalDe: premisa true; con vinculos_familiares caída, lanza', async () => {
    const vinculo = { data: [{ tipo_vinculo: 'tutor_legal_principal' }], error: null }
    expect(await esTutorLegalDe(makeFake(vinculo, vinculo), NINO, USUARIO)).toBe(true)
    await lanza(esTutorLegalDe(makeFake(CAIDA, CAIDA), NINO, USUARIO))
  })
})
