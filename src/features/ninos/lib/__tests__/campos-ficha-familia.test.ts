import { describe, expect, it, vi } from 'vitest'

import { leerCamposAltaFicha } from '../campos-ficha-familia'

/**
 * La ficha de la familia (5b, decisión del 2026-11-11): al autorizado solo se le LEE el lugar de
 * nacimiento (identidad); al tutor legal, también el DNI, los hermanos, la provincia, las
 * observaciones y «cómo nos conoció», que desde `20270115130000` salen por `ficha_gestion_ninos`.
 * Se mide lo que se pide a la base, no lo que se pinta.
 */
function fake(opts: {
  fila?: Record<string, unknown> | null
  error?: { code: string } | null
  gestion?: Record<string, unknown>[] | null
  errorGestion?: { code: string } | null
}) {
  const select = vi.fn()
  const rpc = vi.fn()
  const supabase = {
    from: () => ({
      select: (cols: string) => {
        select(cols)
        return {
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: opts.fila ?? null, error: opts.error ?? null }),
          }),
        }
      },
    }),
    rpc: (nombre: string, args: unknown) => {
      rpc(nombre, args)
      return Promise.resolve({ data: opts.gestion ?? null, error: opts.errorGestion ?? null })
    },
  }
  return { supabase: supabase as never, select, rpc }
}

const columnas = (s: string) => s.split(',').map((c) => c.trim())

describe('leerCamposAltaFicha', () => {
  it('autorizado: solo el lugar de nacimiento, y la función de gestión ni se llama', async () => {
    const { supabase, select, rpc } = fake({ fila: { lugar_nacimiento: 'Valencia' } })
    const r = await leerCamposAltaFicha(supabase, 'n', false)
    expect(select).toHaveBeenCalledTimes(1) // premisa: se leyó una vez
    expect(columnas(select.mock.calls[0]![0] as string)).toEqual(['lugar_nacimiento'])
    expect(rpc).not.toHaveBeenCalled()
    expect(r).toEqual({ lugar_nacimiento: 'Valencia' })
  })

  it('tutor legal: el lugar de la tabla y los cinco de gestión de la función', async () => {
    const { supabase, select, rpc } = fake({
      fila: { lugar_nacimiento: 'Valencia' },
      gestion: [{ nino_id: 'n', dni: '12345678Z', hermanos_total: 2, hermanos_lugar: 1 }],
    })
    const r = await leerCamposAltaFicha(supabase, 'n', true)
    expect(columnas(select.mock.calls[0]![0] as string)).toEqual(['lugar_nacimiento'])
    expect(rpc).toHaveBeenCalledWith('ficha_gestion_ninos', { p_nino_ids: ['n'] })
    expect(r).toMatchObject({ lugar_nacimiento: 'Valencia', dni: '12345678Z', hermanos_total: 2 })
  })

  it('si la lectura falla, null (la pantalla lo dice), no una ficha vacía', async () => {
    const { supabase } = fake({ fila: null, error: { code: '42501' } })
    expect(await leerCamposAltaFicha(supabase, 'n', true)).toBeNull()
  })

  it('tutor legal y la función falla o no trae su fila: null, no rayas', async () => {
    const falla = fake({ fila: { lugar_nacimiento: 'V' }, errorGestion: { code: 'XX000' } })
    expect(await leerCamposAltaFicha(falla.supabase, 'n', true)).toBeNull()
    const vacia = fake({ fila: { lugar_nacimiento: 'V' }, gestion: [] })
    expect(await leerCamposAltaFicha(vacia.supabase, 'n', true)).toBeNull()
  })
})
