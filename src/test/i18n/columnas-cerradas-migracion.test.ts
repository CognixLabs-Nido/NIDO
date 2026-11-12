import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { COLUMNAS_CONTENIDO_FIRMA } from '@/features/autorizaciones/lib/contenido-firmas'
import { COLUMNAS_GESTION_NINO } from '@/features/ninos/lib/ficha-gestion'

/**
 * El autorizado lee solo lo suyo (`20270115130000`): la app pide aparte, por su función, las
 * columnas que la sesión ya no lee de la tabla. Las dos listas de la app se COPIAN de la migración:
 * si alguien cierra o abre una columna en una y no en la otra, la app pediría de la tabla una
 * columna cerrada (42501 y la pantalla sin datos) o dejaría de pedir una abierta.
 */
const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20270115130000_fix_autorizado_lee_solo_lo_suyo.sql'),
  'utf8'
)

/** El ARRAY[...] de la guarda posterior que recorre las columnas cerradas de `tabla`. */
function cerradasEnLaGuarda(tabla: string): string[] {
  const re = new RegExp(
    String.raw`FOREACH c IN ARRAY ARRAY\[([^\]]+)\] LOOP\s+IF has_column_privilege\('authenticated', 'public\.${tabla}'`
  )
  const m = SQL.match(re)
  if (!m) throw new Error(`no encuentro la lista de ${tabla} en la migración`)
  return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!)
}

/** Las columnas del GRANT SELECT (...) ON public.<tabla>. */
function abiertasEnElGrant(tabla: string): string[] {
  const m = SQL.match(
    new RegExp(String.raw`GRANT SELECT \(([^)]+)\) ON public\.${tabla} TO authenticated`)
  )
  if (!m) throw new Error(`no encuentro el GRANT de ${tabla}`)
  return m[1]!.split(',').map((c) => c.trim())
}

/** Todas las columnas que la guarda previa exige a la tabla. */
function todasEnLaGuardaPrevia(tabla: string): string[] {
  const m = SQL.match(
    new RegExp(
      String.raw`'public\.${tabla}'::regclass AND attnum > 0 AND NOT attisdropped;\s+IF v IS DISTINCT FROM '([a-z_,]+)'`
    )
  )
  if (!m) throw new Error(`no encuentro la guarda previa de ${tabla}`)
  return m[1]!.split(',')
}

describe('las columnas cerradas de la app son las de la migración', () => {
  it('ninos: COLUMNAS_GESTION_NINO = las cerradas de la guarda, y con el GRANT suman la tabla', () => {
    expect([...COLUMNAS_GESTION_NINO].sort()).toEqual(cerradasEnLaGuarda('ninos').sort())
    expect([...abiertasEnElGrant('ninos'), ...COLUMNAS_GESTION_NINO].sort()).toEqual(
      todasEnLaGuardaPrevia('ninos').sort()
    )
  })

  it('firmas_autorizacion: COLUMNAS_CONTENIDO_FIRMA = las cerradas, y con el GRANT suman la tabla', () => {
    expect([...COLUMNAS_CONTENIDO_FIRMA].sort()).toEqual(
      cerradasEnLaGuarda('firmas_autorizacion').sort()
    )
    expect(
      [...abiertasEnElGrant('firmas_autorizacion'), ...COLUMNAS_CONTENIDO_FIRMA].sort()
    ).toEqual(todasEnLaGuardaPrevia('firmas_autorizacion').sort())
  })
})
