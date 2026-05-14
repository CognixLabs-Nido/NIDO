import { describe, expect, it } from 'vitest'

import { crearNinoCompletoSchema, infoMedicaSchema, ninoSchema } from '../schemas/nino'

describe('ninoSchema — campos personales', () => {
  const base = {
    nombre: 'Ana',
    apellidos: 'Pérez',
    fecha_nacimiento: '2024-03-15',
    idioma_principal: 'es' as const,
  }

  it('acepta una entrada mínima sin sexo (queda undefined/null)', () => {
    const r = ninoSchema.safeParse(base)
    expect(r.success).toBe(true)
  })

  it('acepta sexo F, M, X explícitos', () => {
    for (const sexo of ['F', 'M', 'X'] as const) {
      const r = ninoSchema.safeParse({ ...base, sexo })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.sexo).toBe(sexo)
    }
  })

  it('acepta sexo: null (caso "Prefiero no decirlo")', () => {
    const r = ninoSchema.safeParse({ ...base, sexo: null })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.sexo).toBeNull()
  })

  it('rechaza sexo con valor fuera del enum', () => {
    const r = ninoSchema.safeParse({ ...base, sexo: 'otro' })
    expect(r.success).toBe(false)
  })

  it('rechaza fecha de nacimiento futura', () => {
    const futura = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const r = ninoSchema.safeParse({ ...base, fecha_nacimiento: futura })
    expect(r.success).toBe(false)
  })
})

describe('infoMedicaSchema — incluye alergias_leves', () => {
  it('acepta alergias_leves como string', () => {
    const r = infoMedicaSchema.safeParse({ alergias_leves: 'polen' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.alergias_leves).toBe('polen')
  })

  it('acepta alergias_leves null o ausente', () => {
    expect(infoMedicaSchema.safeParse({ alergias_leves: null }).success).toBe(true)
    expect(infoMedicaSchema.safeParse({}).success).toBe(true)
  })

  it('rechaza alergias_leves con > 2000 caracteres', () => {
    const r = infoMedicaSchema.safeParse({ alergias_leves: 'a'.repeat(2001) })
    expect(r.success).toBe(false)
  })
})

describe('crearNinoCompletoSchema — wizard 3 pasos', () => {
  const baseDatos = {
    nombre: 'Lucas',
    apellidos: 'García',
    fecha_nacimiento: '2025-06-10',
    sexo: 'M' as const,
    idioma_principal: 'es' as const,
  }

  it('acepta entrada con sexo y alergias_leves rellenos', () => {
    const r = crearNinoCompletoSchema.safeParse({
      datos: baseDatos,
      medica: { alergias_leves: 'polen', medicacion_habitual: null },
      aula_id: 'a1b2c3d4-e5f6-4789-8abc-def012345678',
    })
    if (!r.success) {
      // Surface the issue para diagnosticar.
      throw new Error(`Esperado válido, errores: ${JSON.stringify(r.error.issues)}`)
    }
    expect(r.data.datos.sexo).toBe('M')
    expect(r.data.medica?.alergias_leves).toBe('polen')
  })

  it('acepta sin medica (todos los datos médicos opcionales)', () => {
    const r = crearNinoCompletoSchema.safeParse({
      datos: { ...baseDatos, sexo: null },
      aula_id: 'a1b2c3d4-e5f6-4789-8abc-def012345678',
    })
    expect(r.success).toBe(true)
  })
})
