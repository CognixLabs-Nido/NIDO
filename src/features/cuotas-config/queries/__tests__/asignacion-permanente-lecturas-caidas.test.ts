import { beforeEach, describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * Censo C (B1, lista blanca, 2026-11-26): la asignación permanente de conceptos con una lectura caída.
 * Antes: «ningún alumno»; sin las asignaciones, todos «sin conceptos» y el panel invitaba a asignarlos otra
 * vez; sin el catálogo, sin conceptos que asignar; sin familias o tutores, sin nombre. Ahora lanza
 * `LecturaFallida` (la pinta `admin/error.tsx`). Cada bloque empieza por su premisa. Fixtures ficticios.
 */
const { estado } = vi.hoisted(() => ({
  estado: {
    filas: {} as Record<string, unknown[]>,
    vistas: {} as Record<string, number>,
    falla: null as { tabla: string; n: number } | null,
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in']) c[m] = () => c
      c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const n = (estado.vistas[tabla] = (estado.vistas[tabla] ?? 0) + 1)
        const r =
          estado.falla?.tabla === tabla && estado.falla.n === n
            ? { data: null, error: { code: 'XX000', message: 'caída' } }
            : { data: estado.filas[tabla] ?? [], error: null }
        return Promise.resolve(r).then(res, rej)
      }
      return c
    },
  }),
}))

const { getAsignacionPermanente } = await import('../get-asignacion-permanente')

const CONCEPTO = {
  id: 'k-1',
  nombre: 'Comedor',
  tipo_concepto: 'mensual',
  tipo_valor: 'fijo',
  signo: 'cargo',
  ambito: 'nino',
  importe_centimos: 9000,
  porcentaje_bp: null,
  tarifa_por_anio_nacimiento: false,
  servicio: 'comedor',
  concepto_base_id: null,
}

beforeEach(() => {
  estado.falla = null
  estado.vistas = {}
  estado.filas = {
    ninos: [{ id: 'n-1', nombre: 'Niño', apellidos: 'Demo', familia_id: 'f-1' }],
    familias: [{ id: 'f-1', etiqueta: 'Familia Demo' }],
    familia_tutores: [
      { familia_id: 'f-1', rol_familia: 'titular', nombre_completo: 'Tutora Demo', usuario: null },
    ],
    conceptos_cobro: [CONCEPTO],
    asignacion_concepto: [
      {
        nino_id: 'n-1',
        familia_id: null,
        concepto_id: 'k-1',
        importe_override_centimos: null,
        porcentaje_override_bp: null,
      },
    ],
  }
})

describe('getAsignacionPermanente', () => {
  it('premisa: con todo leído, el alumno con su concepto, su familia con su tutora y el catálogo', async () => {
    const a = await getAsignacionPermanente('c-1')
    expect(a.alumnos[0]?.conceptosAsignados).toEqual(['k-1'])
    expect(a.familias[0]?.tutores).toEqual(['Tutora Demo'])
    expect(a.catalogo).toHaveLength(1)
  })

  it.each([
    ['ninos', 1, 'asignación permanente: alumnos'],
    ['familias', 1, 'asignación permanente: familias'],
    ['familia_tutores', 1, 'asignación permanente: tutores'],
    ['conceptos_cobro', 1, 'asignación permanente: conceptos asignables'],
    ['asignacion_concepto', 1, 'asignación permanente: asignaciones'],
    ['conceptos_cobro', 2, 'asignación permanente: catálogo'],
  ] as const)('con %s n.º %s caída: lanza en «%s»', async (tabla, n, donde) => {
    estado.falla = { tabla, n }
    const e = await getAsignacionPermanente('c-1').then(
      () => null,
      (err: unknown) => err
    )
    expect(esLecturaFallida(e), `esperaba una LecturaFallida, llegó ${String(e)}`).toBe(true)
    expect((e as { donde: string }).donde).toBe(donde)
  })
})
