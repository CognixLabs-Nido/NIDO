import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'
import {
  CLAVES_ERROR_DEVUELTO_COBRADO,
  HINTS_COBRADO,
  HINTS_DEVUELTO,
} from '@/features/remesas/lib/errores-devuelto-cobrado'

/**
 * C (`20261223120000`): los rechazos de marcar un recibo devuelto o cobrado a mano los hacía la app
 * y ahora los hace la base, cada uno con su HINT. Un HINT que la función lance y el mapa no
 * traduzca saldría como «no se pudo», sin decir por qué: es un rechazo perdido por el camino. Así
 * que los HINT de cada función se leen de la migración y se comparan con los del mapa, en los dos
 * sentidos. Y cada clave tiene texto en los tres idiomas.
 */
const MIGRACION = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20261223120000_feat_recibo_devuelto_cobrado_por_funcion.sql'
  ),
  'utf8'
)

function hintsDe(funcion: string): string[] {
  const inicio = MIGRACION.indexOf(`CREATE FUNCTION public.${funcion}(`)
  if (inicio < 0) throw new Error(`no está ${funcion} en la migración`)
  const fin = MIGRACION.indexOf('$function$;', inicio)
  const cuerpo = MIGRACION.slice(inicio, fin)
  return [...new Set([...cuerpo.matchAll(/HINT = '([a-z_]+)'/g)].map((m) => m[1]!))].sort()
}

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

function texto(msgs: Record<string, unknown>, clave: string): string | undefined {
  let v: unknown = msgs
  for (const parte of clave.split('.')) v = (v as Record<string, unknown> | undefined)?.[parte]
  return typeof v === 'string' ? v : undefined
}

describe('los rechazos de la devolución y del cobro a mano', () => {
  it('premisa: las dos funciones lanzan sus HINT (si no, la comparación no mide nada)', () => {
    expect(hintsDe('marcar_recibo_devuelto').length).toBeGreaterThanOrEqual(5)
    expect(hintsDe('marcar_cobrado_manual').length).toBeGreaterThanOrEqual(7)
  })

  it('cada HINT de marcar_recibo_devuelto tiene su clave, y el mapa no tiene de más', () => {
    expect([...HINTS_DEVUELTO].sort()).toEqual(hintsDe('marcar_recibo_devuelto'))
  })

  it('cada HINT de marcar_cobrado_manual tiene su clave, y el mapa no tiene de más', () => {
    expect([...HINTS_COBRADO].sort()).toEqual(hintsDe('marcar_cobrado_manual'))
  })

  for (const [locale, msgs] of LOCALES) {
    it.each([...CLAVES_ERROR_DEVUELTO_COBRADO])(`${locale}: %s existe y no está vacía`, (clave) => {
      expect(texto(msgs, clave)?.trim().length ?? 0).toBeGreaterThan(0)
    })
  }
})
