import { beforeEach, describe, expect, it, vi } from 'vitest'

import { guardarPaseServicios } from '../guardar-pase-servicios'

/**
 * PR-12: el listado único guarda en UN upsert las casillas cambiadas de los tres servicios, con
 * la sesión de quien lo rellena. Cada «no» con su motivo; una entrada inválida no escribe nada.
 */

const { estado } = vi.hoisted(() => ({
  estado: {
    upserts: [] as Array<{ tabla: string; filas: unknown; opciones: unknown }>,
    error: null as { code?: string; message: string } | null,
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => ({
      upsert: async (filas: unknown, opciones: unknown) => {
        estado.upserts.push({ tabla, filas, opciones })
        return { error: estado.error }
      },
    }),
  }),
}))

const CENTRO = '11111111-1111-4111-8111-111111111111'
const A = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000002'

const entrada = {
  centro_id: CENTRO,
  fecha: '2026-10-26',
  items: [
    { nino_id: A, servicio: 'matinera' as const, presente: true },
    { nino_id: A, servicio: 'comedor' as const, presente: true },
    { nino_id: B, servicio: 'vespertina' as const, presente: false },
  ],
}

beforeEach(() => {
  estado.upserts = []
  estado.error = null
})

describe('guardarPaseServicios', () => {
  it('guarda los tres servicios en un solo upsert sobre (niño, fecha, servicio)', async () => {
    const r = await guardarPaseServicios(entrada)
    expect(r).toEqual({ success: true, data: { count: 3 } })
    expect(estado.upserts).toHaveLength(1)
    expect(estado.upserts[0]).toEqual({
      tabla: 'parte_servicio_diario',
      opciones: { onConflict: 'nino_id,fecha,servicio' },
      filas: [
        {
          centro_id: CENTRO,
          nino_id: A,
          fecha: '2026-10-26',
          servicio: 'matinera',
          presente: true,
        },
        { centro_id: CENTRO, nino_id: A, fecha: '2026-10-26', servicio: 'comedor', presente: true },
        {
          centro_id: CENTRO,
          nino_id: B,
          fecha: '2026-10-26',
          servicio: 'vespertina',
          presente: false,
        },
      ],
    })
  })

  it('la RLS lo rechaza (42501): sin permiso', async () => {
    estado.error = { code: '42501', message: 'new row violates row-level security policy' }
    expect(await guardarPaseServicios(entrada)).toEqual({
      success: false,
      error: 'parte_servicio.errors.sin_permiso',
    })
  })

  it('el mes está cerrado (congelar_si_mes_cerrado): mes cerrado', async () => {
    estado.error = {
      code: 'P0001',
      message: 'mes cerrado: el parte de servicio de 2026-10 no es editable',
    }
    expect(await guardarPaseServicios(entrada)).toEqual({
      success: false,
      error: 'parte_servicio.errors.mes_cerrado',
    })
  })

  it('cualquier otro error: no se pudo guardar', async () => {
    estado.error = { code: '23505', message: 'duplicate key' }
    expect(await guardarPaseServicios(entrada)).toEqual({
      success: false,
      error: 'parte_servicio.errors.guardar_fallo',
    })
  })

  it('una entrada inválida no escribe nada', async () => {
    const r = await guardarPaseServicios({ ...entrada, fecha: '26-10-2026' })
    expect(r).toEqual({ success: false, error: 'parte_servicio.validation.fecha_invalida' })
    expect(estado.upserts).toEqual([])
  })
})
