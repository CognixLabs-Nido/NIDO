import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Censo C (decisión de Jose del 2026-11-25, «asegurarAgenda va en el PR A»): la profe escribe en la agenda
 * lo que ha pasado, y si la fila padre del día no se pudo LEER, o el insert falló por algo que no es la RLS,
 * la pantalla le decía «Ya no puedes editar este día». Dos motivos falsos. Ahora:
 *   · lectura fallida y el día sin agenda → se crea y se guarda (lo que ya pasaba, y es verdad);
 *   · lectura fallida y la agenda ya estaba (el insert choca, 23505) → se relee una vez; si tampoco se
 *     puede, «no se ha podido leer»;
 *   · insert negado por la RLS (42501) → «fuera de la ventana de edición», el único caso en que es verdad;
 *   · insert que falla por otra cosa → «no se pudo guardar».
 * (Medido el 2026-11-25 contra el código de antes: la lectura fallida con el día sin agenda ya guardaba; el
 * diseño de «parar al no leer» habría convertido ese guardado en un «no».)
 * Se mide por las acciones que la usan (biberón y el pase de comidas), no por la forma del helper.
 */

type Res = { data: unknown; error: { code?: string; message: string } | null }

const estado: {
  lecturasAgenda: Res[]
  insertAgenda: Res
  llamadas: string[]
} = { lecturasAgenda: [], insertAgenda: { data: null, error: null }, llamadas: [] }
const SIN_FILA: Res = { data: null, error: null }

function cadena(tabla: string) {
  let op = 'select'
  const b: Record<string, unknown> = {}
  const fin = () => {
    estado.llamadas.push(`${tabla}.${op}`)
    if (tabla === 'agendas_diarias')
      return Promise.resolve(
        op === 'insert' ? estado.insertAgenda : (estado.lecturasAgenda.shift() ?? SIN_FILA)
      )
    if (tabla === 'biberones') return Promise.resolve({ data: { id: 'biberon-1' }, error: null })
    if (tabla === 'comidas') return Promise.resolve({ data: [], error: null })
    return Promise.resolve({ data: null, error: null })
  }
  for (const m of ['select', 'eq', 'in', 'not', 'is']) b[m] = () => b
  b.insert = () => {
    op = 'insert'
    return b
  }
  b.maybeSingle = fin
  b.single = fin
  b.then = (r: (v: unknown) => unknown, j: (e: unknown) => unknown) => fin().then(r, j)
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({ from: (t: string) => cadena(t) }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

import { batchRegistrarComidasPlatos } from '@/features/menus/actions/batch-registrar-comidas-platos'

import { upsertBiberon } from '../upsert-biberon'

const NINO = '22222222-2222-4222-8222-222222222222'
const MENU = '33333333-3333-4333-8333-333333333333'
const FECHA = '2026-11-25'
const BIBERON = {
  hora: '10:00',
  cantidad_ml: 120,
  tipo: 'formula',
  tomado_completo: true,
  observaciones: null,
} as const

beforeEach(() => {
  estado.lecturasAgenda = []
  estado.insertAgenda = { data: { id: 'agenda-1' }, error: null }
  estado.llamadas = []
})

describe('asegurarAgenda, por sus acciones: el motivo es el de verdad', () => {
  it('premisa: con la agenda leída y sin fila, se crea y el biberón se guarda', async () => {
    const r = await upsertBiberon(NINO, FECHA, BIBERON)
    expect(r).toEqual({ success: true, data: { id: 'biberon-1' } })
    expect(estado.llamadas).toContain('agendas_diarias.insert')
  })

  it('la lectura falla y el día no tenía agenda: se crea y el biberón se guarda (es verdad)', async () => {
    estado.lecturasAgenda = [{ data: null, error: { message: 'timeout' } }]
    expect(await upsertBiberon(NINO, FECHA, BIBERON)).toEqual({
      success: true,
      data: { id: 'biberon-1' },
    })
  })

  it('la lectura falla y la agenda ya estaba (23505): se relee, y si se lee, se guarda en ella', async () => {
    estado.lecturasAgenda = [
      { data: null, error: { message: 'timeout' } },
      { data: { id: 'agenda-1' }, error: null },
    ]
    estado.insertAgenda = { data: null, error: { code: '23505', message: 'duplicate key value' } }
    expect(await upsertBiberon(NINO, FECHA, BIBERON)).toEqual({
      success: true,
      data: { id: 'biberon-1' },
    })
  })

  it('la lectura falla, la agenda ya estaba y la relectura también falla: «no se ha podido leer»', async () => {
    estado.lecturasAgenda = [
      { data: null, error: { message: 'timeout' } },
      { data: null, error: { message: 'timeout' } },
    ]
    estado.insertAgenda = { data: null, error: { code: '23505', message: 'duplicate key value' } }
    expect(await upsertBiberon(NINO, FECHA, BIBERON)).toEqual({
      success: false,
      error: 'common.lectura_fallida',
    })
  })

  it('el insert lo niega la RLS (42501): fuera de la ventana, el único caso en que es verdad', async () => {
    estado.insertAgenda = {
      data: null,
      error: { code: '42501', message: 'new row violates row-level security policy' },
    }
    expect(await upsertBiberon(NINO, FECHA, BIBERON)).toEqual({
      success: false,
      error: 'agenda.errors.fuera_de_ventana',
    })
  })

  it('el insert falla por otra cosa (red, un CHECK): «no se pudo guardar», no «ya no puedes editar»', async () => {
    estado.insertAgenda = { data: null, error: { code: '08006', message: 'connection failure' } }
    expect(await upsertBiberon(NINO, FECHA, BIBERON)).toEqual({
      success: false,
      error: 'agenda.errors.guardar_fallo',
    })
  })

  it('el pase de comidas: agenda ilegible dos veces → «no se ha podido leer»; la RLS → fuera de ventana', async () => {
    const entrada = {
      fecha: FECHA,
      momento: 'comida' as const,
      menu_dia_id: MENU,
      filas: [
        {
          nino_id: NINO,
          tipo_plato: 'primer_plato' as const,
          cantidad: 'todo' as const,
          descripcion: null,
        },
      ],
    }
    estado.lecturasAgenda = [
      { data: null, error: { message: 'timeout' } },
      { data: null, error: { message: 'timeout' } },
    ]
    estado.insertAgenda = { data: null, error: { code: '23505', message: 'duplicate key value' } }
    expect(await batchRegistrarComidasPlatos(entrada)).toEqual({
      success: false,
      error: 'common.lectura_fallida',
    })

    estado.lecturasAgenda = []
    estado.insertAgenda = { data: null, error: { code: '42501', message: 'row-level security' } }
    expect(await batchRegistrarComidasPlatos(entrada)).toEqual({
      success: false,
      error: 'menus.toasts.error_fuera_de_ventana',
    })
  })
})
