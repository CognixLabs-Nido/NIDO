import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { asistenciaInputSchema } from '@/features/asistencia/schemas/asistencia'
import { editarCitaSchema } from '@/features/agenda/schemas/citas'
import { suenoInputSchema } from '@/features/agenda-diaria/schemas/agenda-diaria'
import { editarEventoSchema } from '@/features/eventos/schemas/eventos'

import { horaSchema } from '../hora'

/**
 * La hora: una sola definición (C, 2026-11-23, «cierra la clase, no el caso»). Tres partes:
 * 1. el esquema común acepta 'HH:MM' y 'HH:MM:SS' y deja 'HH:MM';
 * 2. los CUATRO esquemas que validan horas aceptan una hora tal como la devuelve la base;
 * 3. la clase: ningún otro fichero de `src` valida una hora con su propia regex. Si aparece uno,
 *    este test lo nombra.
 */

const SRC = join(__dirname, '..', '..', '..')
const COMUN = join(SRC, 'shared', 'lib', 'hora.ts')
const UUID = '11111111-1111-4111-8111-111111111111'

/** Una regex de hora: `\d{2}:\d{2}` dentro de un literal `/…/`. */
const REGEX_DE_HORA = /\/\^?\\d\{2\}:\\d\{2\}/

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === '__tests__' || n === 'test' ? [] : ficheros(p)
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
  })
}

describe('el esquema común', () => {
  const h = horaSchema('m')
  it.each([
    ['09:30', '09:30'],
    ['09:30:00', '09:30'],
    ['23:59:59', '23:59'],
  ])('%s → %s', (entra, sale) => {
    const r = h.safeParse(entra)
    expect(r.success, `acepta ${entra}`).toBe(true)
    if (r.success) expect(r.data).toBe(sale)
  })
  it.each(['9:30', '09:3', '09:30:0', '09:30:00:00', 'nueve', ''])('rechaza «%s»', (x) => {
    expect(h.safeParse(x).success).toBe(false)
  })
})

describe('los cuatro esquemas aceptan la hora tal como la devuelve la base', () => {
  it('asistencia', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'presente',
      hora_llegada: '09:05:00',
      observaciones: '',
    })
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
    if (r.success) expect(r.data.hora_llegada).toBe('09:05')
  })
  it('agenda diaria (sueño), y fin > inicio compara ya recortado', () => {
    const r = suenoInputSchema.safeParse({
      hora_inicio: '13:00:00',
      hora_fin: '14:30',
      calidad: null,
      observaciones: null,
    })
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
    if (r.success) expect([r.data.hora_inicio, r.data.hora_fin]).toEqual(['13:00', '14:30'])
    // El mismo minuto en los dos formatos: fin no es posterior a inicio.
    expect(
      suenoInputSchema.safeParse({
        hora_inicio: '13:00:00',
        hora_fin: '13:00',
        calidad: null,
        observaciones: null,
      }).success
    ).toBe(false)
  })
  it('citas (editar)', () => {
    const r = editarCitaSchema.safeParse({
      cita_id: UUID,
      titulo: 'Tutoría',
      fecha: '2027-03-03',
      hora_inicio: '10:00:00',
      hora_fin: '10:30:00',
    })
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
    if (r.success) expect([r.data.hora_inicio, r.data.hora_fin]).toEqual(['10:00', '10:30'])
  })
  it('eventos (editar)', () => {
    const r = editarEventoSchema.safeParse({
      evento_id: UUID,
      tipo: 'excursion',
      titulo: 'Granja',
      fecha: '2027-03-03',
      hora_inicio: '09:00:00',
      hora_fin: '12:00:00',
    })
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
    if (r.success) expect([r.data.hora_inicio, r.data.hora_fin]).toEqual(['09:00', '12:00'])
  })
})

describe('la clase: una sola regex de hora en src', () => {
  it('control: el detector reconoce el esquema viejo', () => {
    const viejo = "const horaSchema = z.string().regex(/^\\d{2}:\\d{2}$/, 'x.hora_invalida')"
    expect(REGEX_DE_HORA.test(viejo)).toBe(true)
  })

  it('ninguna otra regex de hora; y los cuatro esquemas importan la común', () => {
    const todos = ficheros(SRC)
    expect(todos.length, 'premisa: recorre src').toBeGreaterThan(500)
    const otras = todos
      .filter((p) => p !== COMUN && REGEX_DE_HORA.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p))
    expect(otras, 'ficheros con su propia regex de hora').toEqual([])
    expect(REGEX_DE_HORA.test(readFileSync(COMUN, 'utf8')), 'la común sí la tiene').toBe(true)
    const usan = todos
      .filter((p) => readFileSync(p, 'utf8').includes("from '@/shared/lib/hora'"))
      .map((p) => relative(SRC, p))
      .sort()
    expect(usan).toEqual([
      'features/agenda-diaria/schemas/agenda-diaria.ts',
      'features/agenda/schemas/citas.ts',
      'features/asistencia/schemas/asistencia.ts',
      'features/eventos/schemas/eventos.ts',
    ])
  })
})
