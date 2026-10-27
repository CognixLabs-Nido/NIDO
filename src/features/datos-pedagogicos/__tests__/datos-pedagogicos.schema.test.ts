import { describe, expect, it } from 'vitest'

import { Constants } from '@/types/database'

import en from '../../../../messages/en.json'
import es from '../../../../messages/es.json'
import va from '../../../../messages/va.json'
import { datosPedagogicosInputSchema, tipoAlimentacionEnum } from '../schemas/datos-pedagogicos'

const NINO_ID = 'a1b2c3d4-e5f6-4789-8abc-def012345678'

function base() {
  return {
    nino_id: NINO_ID,
    lactancia_estado: 'materna' as const,
    lactancia_observaciones: null,
    control_esfinteres: 'panal_completo' as const,
    control_esfinteres_observaciones: null,
    siesta_horario_habitual: null,
    siesta_numero_diario: null,
    siesta_observaciones: null,
    tipo_alimentacion: 'omnivora' as const,
    alimentacion_observaciones: null,
    idiomas_casa: ['es'],
    tiene_hermanos_en_centro: false,
  }
}

describe('datosPedagogicosInputSchema', () => {
  it('acepta un input mínimo válido', () => {
    const r = datosPedagogicosInputSchema.safeParse(base())
    expect(r.success).toBe(true)
  })

  it('rechaza un idioma con más de 2 caracteres', () => {
    const input = { ...base(), idiomas_casa: ['english'] }
    const r = datosPedagogicosInputSchema.safeParse(input)
    expect(r.success).toBe(false)
  })

  it('rechaza idiomas_casa vacío', () => {
    const input = { ...base(), idiomas_casa: [] }
    const r = datosPedagogicosInputSchema.safeParse(input)
    expect(r.success).toBe(false)
  })

  it('rechaza siesta_numero_diario fuera de rango (negativo)', () => {
    const input = { ...base(), siesta_numero_diario: -1 }
    const r = datosPedagogicosInputSchema.safeParse(input)
    expect(r.success).toBe(false)
  })

  it('rechaza siesta_numero_diario fuera de rango (>5)', () => {
    const input = { ...base(), siesta_numero_diario: 6 }
    const r = datosPedagogicosInputSchema.safeParse(input)
    expect(r.success).toBe(false)
  })

  it('exige alimentacion_observaciones cuando tipo_alimentacion = otra', () => {
    const input = {
      ...base(),
      tipo_alimentacion: 'otra' as const,
      alimentacion_observaciones: null,
    }
    const r = datosPedagogicosInputSchema.safeParse(input)
    expect(r.success).toBe(false)
  })

  it('acepta tipo_alimentacion = otra cuando hay observaciones no vacías', () => {
    const input = {
      ...base(),
      tipo_alimentacion: 'otra' as const,
      alimentacion_observaciones: 'Dieta paleo',
    }
    const r = datosPedagogicosInputSchema.safeParse(input)
    expect(r.success).toBe(true)
  })

  it('normaliza idiomas a lowercase y trim', () => {
    const input = { ...base(), idiomas_casa: ['ES', ' va '] }
    const r = datosPedagogicosInputSchema.safeParse(input)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.idiomas_casa).toEqual(['es', 'va'])
    }
  })

  it('rechaza enum inválido en lactancia_estado', () => {
    const input = { ...base(), lactancia_estado: 'inventado' as never }
    const r = datosPedagogicosInputSchema.safeParse(input)
    expect(r.success).toBe(false)
  })

  // 20261125120000: sin religiosa_halal ni religiosa_kosher (categoría especial, art. 9 RGPD).
  it.each(['religiosa_halal', 'religiosa_kosher'])('rechaza tipo_alimentacion = %s', (valor) => {
    const r = datosPedagogicosInputSchema.safeParse({ ...base(), tipo_alimentacion: valor })
    expect(r.success).toBe(false)
  })
})

describe('tipo_alimentacion: un solo catálogo', () => {
  it('el esquema tiene los mismos valores que el enum de la BD (tipos generados)', () => {
    expect([...tipoAlimentacionEnum.options]).toEqual([...Constants.public.Enums.tipo_alimentacion])
  })

  it.each([
    ['es', es],
    ['en', en],
    ['va', va],
  ])('%s traduce exactamente esos valores, ni uno más', (_locale, mensajes) => {
    const claves = Object.keys(mensajes.pedagogico.alimentacion_opciones).sort()
    expect(claves).toEqual([...tipoAlimentacionEnum.options].sort())
  })
})
