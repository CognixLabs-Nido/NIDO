import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DatosPedagogicosRow } from '../queries/get-datos-pedagogicos'

/**
 * Lactancia, esfínteres y alimentación pueden estar SIN CONTESTAR (C, 2026-11-24: opcionales y el
 * formulario en blanco). Ninguna pantalla convierte ese vacío en un valor: ni la vista de la familia
 * (con la clave hecha a mano pintaba «lactancia_opciones.null»), ni el ✓ del avance del alta (salía
 * con que hubiera fila), ni el esquema (que exigía los tres).
 */
vi.mock('server-only', () => ({}))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (k: string) => k,
}))

const { DatosPedagogicosReadOnly } = await import('../components/DatosPedagogicosReadOnly')
const { datosPedagogicosContestados } = await import('../lib/contestados')
const { datosPedagogicosInputSchema } = await import('../schemas/datos-pedagogicos')

const FILA: DatosPedagogicosRow = {
  id: 'fila',
  nino_id: 'a1b2c3d4-e5f6-4789-8abc-def012345678',
  lactancia_estado: null,
  lactancia_observaciones: null,
  control_esfinteres: null,
  control_esfinteres_observaciones: null,
  siesta_horario_habitual: '13:00',
  siesta_numero_diario: null,
  siesta_observaciones: null,
  tipo_alimentacion: null,
  alimentacion_observaciones: null,
  idiomas_casa: ['es'],
  tiene_hermanos_en_centro: false,
  updated_at: '2026-11-24T10:00:00Z',
}

describe('sin contestar no es un valor', () => {
  it('vista de la familia: los tres vacíos se leen «sin contestar», nunca la clave', async () => {
    render(await DatosPedagogicosReadOnly({ data: FILA }))
    expect(screen.getAllByText('sin_contestar')).toHaveLength(3)
    expect(document.body.textContent).not.toMatch(/\.null|undefined/)
    expect(screen.getByText('13:00'), 'premisa: la fila se pinta').toBeTruthy()
  })

  it('vista de la familia · control: con valor, su opción', async () => {
    render(
      await DatosPedagogicosReadOnly({
        data: {
          ...FILA,
          lactancia_estado: 'biberon',
          control_esfinteres: 'transicion',
          tipo_alimentacion: 'omnivora',
        },
      })
    )
    expect(screen.queryByText('sin_contestar')).toBeNull()
    expect(screen.getByText('lactancia_opciones.biberon')).toBeTruthy()
  })

  it.each([
    ['sin fila → sin ✓', null, false],
    ['fila con solo la siesta → sin ✓', FILA, false],
    [
      'falta la lactancia → sin ✓',
      { ...FILA, control_esfinteres: 'transicion', tipo_alimentacion: 'omnivora' },
      false,
    ],
    [
      'falta la alimentación → sin ✓',
      { ...FILA, lactancia_estado: 'mixta', control_esfinteres: 'transicion' },
      false,
    ],
    [
      'los tres contestados → ✓',
      {
        ...FILA,
        lactancia_estado: 'mixta',
        control_esfinteres: 'transicion',
        tipo_alimentacion: 'otra',
      },
      true,
    ],
  ] as const)('el ✓ del avance del alta: %s', (_, datos, esperado) => {
    expect(datosPedagogicosContestados(datos)).toBe(esperado)
  })

  it('el esquema acepta los tres vacíos (son opcionales) y no los rellena', () => {
    const r = datosPedagogicosInputSchema.safeParse({ ...FILA, nino_id: FILA.nino_id })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.lactancia_estado).toBeNull()
      expect(r.data.control_esfinteres).toBeNull()
      expect(r.data.tipo_alimentacion).toBeNull()
    }
  })
})
