import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/db'

import { leerTutoresDeNino } from '../tutores-familia'

const NINO = '22222222-2222-4222-8222-222222222222'
const FAMILIA = '33333333-3333-4333-8333-333333333333'
const YO = '11111111-1111-4111-8111-111111111111'
const OTRO = '99999999-9999-4999-8999-999999999999'

const filas = [
  { id: 'f1', rol_familia: 'titular', usuario_id: YO, email: 'a@x.test', nombre_completo: 'A' },
  {
    id: 'f2',
    rol_familia: 'segundo_tutor',
    usuario_id: OTRO,
    email: 'b@x.test',
    nombre_completo: 'B',
  },
]

/** Un cliente falso: el niño y su familia, las filas de la tabla y `tutores_de_familia`. */
function cliente(rpc: { data: unknown; error: unknown }) {
  const resuelve = (r: unknown) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is']) b[m] = () => b
    b.maybeSingle = () => Promise.resolve(r)
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve(r).then(ok)
    return b
  }
  return {
    from: (t: string) =>
      t === 'ninos'
        ? resuelve({ data: { familia_id: FAMILIA }, error: null })
        : resuelve({ data: filas, error: null }),
    rpc: () => Promise.resolve(rpc),
  } as unknown as SupabaseClient<Database>
}

/**
 * Censo del 2026-11-18 («qué hacen con el no»): un `ve_personales` en falso puede ser la regla de la
 * fase 6 (el otro tutor tiene cuenta y gestiona él sus datos) o que `tutores_de_familia` falló. Antes
 * llegaban iguales; ahora lo segundo lo dice `personalesLeidos`.
 */
describe('leerTutoresDeNino · la regla y el fallo no llegan iguales', () => {
  it('con la función bien: el otro tutor, oculto por la regla, y personalesLeidos', async () => {
    const r = await leerTutoresDeNino(
      cliente({
        data: [
          { id: 'f1', ve_personales: true, ve_telefono: true },
          { id: 'f2', ve_personales: false, ve_telefono: true },
        ],
        error: null,
      }),
      NINO
    )
    expect(r.tutores.map((t) => [t.usuario_id, t.ve_personales])).toEqual([
      [YO, true],
      [OTRO, false],
    ])
    expect(r).toMatchObject({ leidos: true, personalesLeidos: true })
  })

  it('si la función falla: las filas siguen (lo abierto), pero personalesLeidos es falso', async () => {
    const r = await leerTutoresDeNino(cliente({ data: null, error: { code: 'XX000' } }), NINO)
    expect(r.tutores).toHaveLength(2)
    expect(r.tutores.every((t) => !t.ve_personales)).toBe(true)
    expect(r).toMatchObject({ leidos: true, personalesLeidos: false })
  })
})
