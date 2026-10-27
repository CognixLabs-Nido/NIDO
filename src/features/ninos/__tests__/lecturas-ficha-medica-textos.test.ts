import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it, vi } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

vi.mock('server-only', () => ({}))

const { CAMPOS_FICHA, ORIGENES_LECTURA, ROLES_LECTOR } =
  await import('../queries/get-lecturas-ficha-medica')

/**
 * El registro de lecturas de la ficha médica (`20261128120000`): los papeles, los orígenes y los
 * campos que admite la tabla se leen de sus CHECK en la migración, no se enumeran aquí. La app los
 * conoce todos y cada uno tiene su texto en los tres idiomas: next-intl lanza con una clave que
 * falta, y la ficha del niño no saldría.
 */

const migracion = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261128120000_feat_ficha_medica_lecturas.sql'),
  'utf8'
)

function valoresDelCheck(columna: string, forma: 'IN' | 'ARRAY'): string[] {
  const patron =
    forma === 'IN'
      ? new RegExp(`CHECK \\(${columna} IN \\(([^)]*)\\)\\)`)
      : new RegExp(`CHECK \\(${columna} <@ ARRAY\\[([^\\]]*)\\]\\)`)
  const m = patron.exec(migracion.replace(/\s+/g, ' '))
  if (!m) throw new Error(`no encuentro el CHECK de ${columna}`)
  return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort()
}

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

describe('registro de lecturas de la ficha médica', () => {
  it('la app conoce exactamente los valores que admite la tabla', () => {
    expect([...ROLES_LECTOR].sort()).toEqual(valoresDelCheck('rol_lector', 'IN'))
    expect([...ORIGENES_LECTURA].sort()).toEqual(valoresDelCheck('origen', 'IN'))
    expect([...CAMPOS_FICHA].sort()).toEqual(valoresDelCheck('campos', 'ARRAY'))
  })

  for (const [locale, msgs] of LOCALES) {
    it(`${locale}: cada papel, origen y campo tiene su texto`, () => {
      const ns = msgs.ficha_medica_lecturas as Record<string, Record<string, string>>
      for (const [grupo, valores] of [
        ['rol', ROLES_LECTOR],
        ['origen', ORIGENES_LECTURA],
        ['campo', CAMPOS_FICHA],
      ] as const) {
        for (const v of valores) expect(ns[grupo]?.[v]?.trim(), `${grupo}.${v}`).toBeTruthy()
      }
    })
  }
})
