import { randomUUID } from 'crypto'
import { describe, expect, it } from 'vitest'

import {
  batchRegistrarComidasPlatosSchema,
  crearPlantillaMensualSchema,
  guardarMenuMesSchema,
  menuDiaInputSchema,
} from '../schemas/menu'

describe('crearPlantillaMensualSchema', () => {
  it('acepta input válido', () => {
    expect(
      crearPlantillaMensualSchema.safeParse({
        centro_id: randomUUID(),
        mes: 10,
        anio: 2026,
      }).success
    ).toBe(true)
  })

  it('rechaza mes fuera de rango', () => {
    expect(
      crearPlantillaMensualSchema.safeParse({ centro_id: randomUUID(), mes: 13, anio: 2026 })
        .success
    ).toBe(false)
  })

  it('rechaza año < 2024', () => {
    expect(
      crearPlantillaMensualSchema.safeParse({ centro_id: randomUUID(), mes: 1, anio: 2023 }).success
    ).toBe(false)
  })
})

describe('menuDiaInputSchema', () => {
  it('acepta todos los campos null (día sin nada definido)', () => {
    expect(
      menuDiaInputSchema.safeParse({
        fecha: '2026-10-15',
        desayuno: null,
        media_manana: null,
        comida_primero: null,
        comida_segundo: null,
        comida_postre: null,
        merienda: null,
      }).success
    ).toBe(true)
  })

  it('rechaza campo > 300 chars', () => {
    const r = menuDiaInputSchema.safeParse({
      fecha: '2026-10-15',
      desayuno: 'x'.repeat(301),
      media_manana: null,
      comida_primero: null,
      comida_segundo: null,
      comida_postre: null,
      merienda: null,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0].message).toBe('menus.validation.campo_largo')
    }
  })

  it('rechaza fecha mal formada', () => {
    expect(
      menuDiaInputSchema.safeParse({
        fecha: '15-10-2026',
        desayuno: null,
        media_manana: null,
        comida_primero: null,
        comida_segundo: null,
        comida_postre: null,
        merienda: null,
      }).success
    ).toBe(false)
  })
})

describe('guardarMenuMesSchema', () => {
  it('acepta hasta 40 días (cubre el caso máximo de mes con escuela_verano)', () => {
    const menus = Array.from({ length: 40 }, (_, i) => ({
      fecha: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
      desayuno: null,
      media_manana: null,
      comida_primero: 'Macarrones',
      comida_segundo: null,
      comida_postre: null,
      merienda: null,
    }))
    expect(guardarMenuMesSchema.safeParse({ plantilla_id: randomUUID(), menus }).success).toBe(true)
  })

  it('acepta array vacío (caso "guardar mes sin cambios")', () => {
    expect(guardarMenuMesSchema.safeParse({ plantilla_id: randomUUID(), menus: [] }).success).toBe(
      true
    )
  })

  it('rechaza más de 40 menús (anti-abuso)', () => {
    const menus = Array.from({ length: 41 }, () => ({
      fecha: '2026-10-15',
      desayuno: null,
      media_manana: null,
      comida_primero: null,
      comida_segundo: null,
      comida_postre: null,
      merienda: null,
    }))
    expect(guardarMenuMesSchema.safeParse({ plantilla_id: randomUUID(), menus }).success).toBe(
      false
    )
  })
})

describe('batchRegistrarComidasPlatosSchema', () => {
  const base = () => ({
    fecha: '2026-10-15',
    momento: 'comida' as const,
    menu_dia_id: randomUUID(),
    filas: [
      {
        nino_id: randomUUID(),
        tipo_plato: 'primer_plato' as const,
        cantidad: 'todo' as const,
        descripcion: 'Macarrones',
      },
    ],
  })

  it('acepta batch mínimo (1 fila)', () => {
    expect(batchRegistrarComidasPlatosSchema.safeParse(base()).success).toBe(true)
  })

  it('rechaza filas vacías', () => {
    const r = batchRegistrarComidasPlatosSchema.safeParse({ ...base(), filas: [] })
    expect(r.success).toBe(false)
  })

  it('rechaza cantidad fuera del enum', () => {
    const r = batchRegistrarComidasPlatosSchema.safeParse({
      ...base(),
      filas: [
        {
          nino_id: randomUUID(),
          tipo_plato: 'primer_plato',
          cantidad: 'inventado' as 'todo',
          descripcion: null,
        },
      ],
    })
    expect(r.success).toBe(false)
  })
})
