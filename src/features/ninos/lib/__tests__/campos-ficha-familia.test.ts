import { describe, expect, it, vi } from 'vitest'

import { leerCamposAltaFicha } from '../campos-ficha-familia'

/**
 * La ficha de la familia (5b, decisión del 2026-11-11): al autorizado solo se le LEE el lugar de
 * nacimiento (identidad); al tutor legal, también el DNI, los hermanos, la provincia, las
 * observaciones y «cómo nos conoció». Se mide lo que se pide a la base, no lo que se pinta.
 */
function fake(fila: Record<string, unknown> | null, error: { code: string } | null = null) {
  const select = vi.fn()
  const supabase = {
    from: () => ({
      select: (cols: string) => {
        select(cols)
        return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: fila, error }) }) }
      },
    }),
  }
  return { supabase: supabase as never, select }
}

const columnas = (s: string) => s.split(',').map((c) => c.trim())

describe('leerCamposAltaFicha', () => {
  it('autorizado: solo el lugar de nacimiento; nada de DNI ni de lo de gestión', async () => {
    const { supabase, select } = fake({ lugar_nacimiento: 'Valencia' })
    const r = await leerCamposAltaFicha(supabase, 'n', false)
    expect(select).toHaveBeenCalledTimes(1) // premisa: se leyó una vez
    expect(columnas(select.mock.calls[0]![0] as string)).toEqual(['lugar_nacimiento'])
    expect(r).toEqual({ lugar_nacimiento: 'Valencia' })
  })

  it('tutor legal: el lugar y los cinco de gestión', async () => {
    const { supabase, select } = fake({ lugar_nacimiento: 'Valencia' })
    await leerCamposAltaFicha(supabase, 'n', true)
    expect(columnas(select.mock.calls[0]![0] as string)).toEqual(
      expect.arrayContaining([
        'lugar_nacimiento',
        'dni',
        'hermanos_total',
        'hermanos_lugar',
        'direccion_provincia',
        'observaciones_familia',
        'como_nos_conocio',
        'como_nos_conocio_otro',
      ])
    )
  })

  it('si la lectura falla, null (la pantalla lo dice), no una ficha vacía', async () => {
    const { supabase } = fake(null, { code: '42501' })
    expect(await leerCamposAltaFicha(supabase, 'n', true)).toBeNull()
  })
})
