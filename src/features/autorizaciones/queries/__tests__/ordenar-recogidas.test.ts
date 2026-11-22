import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => null }))

const { ordenarRecogidasParaLaPuerta } = await import('../get-nombres-recogidas')

/**
 * El listado de la puerta (2026-11-21): las recogidas de las aulas de quien consulta van primero,
 * después las del resto del centro; dentro de cada grupo, por apellidos y nombre. Una recogida sin
 * nombre (no tiene matrícula activa) va al final del centro, nunca a «las mías».
 */
describe('ordenarRecogidasParaLaPuerta', () => {
  const n = (nombre: string, apellidos: string | null, deMiAula: boolean) => ({
    nombre,
    apellidos,
    deMiAula,
  })

  it('las suyas primero, después el centro, cada grupo por apellidos', () => {
    const nombres = new Map([
      ['a', n('Zoe', 'Abad', false)],
      ['b', n('Ana', 'Ruiz', true)],
      ['c', n('Luis', 'Bravo', true)],
      ['d', n('Eva', 'Ávila', false)],
    ])
    const { mias, centro } = ordenarRecogidasParaLaPuerta(
      ['a', 'b', 'c', 'd', 'sin'].map((id) => ({ id })),
      nombres
    )
    expect(mias.map((r) => r.id)).toEqual(['c', 'b'])
    expect(centro.map((r) => r.id)).toEqual(['a', 'd', 'sin'])
  })
})
