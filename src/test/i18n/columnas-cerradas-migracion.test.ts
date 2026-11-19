import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { COLUMNAS_CONTENIDO_FIRMA_FICHA } from '@/features/alta/lib/contenido-firmas-ficha'
import { COLUMNAS_CONTENIDO_FIRMA } from '@/features/autorizaciones/lib/contenido-firmas'
import { COLUMNAS_CONTENIDO_FIRMA_DOCUMENTO } from '@/features/documentos-centro/lib/contenido-firmas-documentos'
import { COLUMNAS_GESTION_NINO } from '@/features/ninos/lib/ficha-gestion'

/**
 * El autorizado lee solo lo suyo (`20270115130000`): la app pide aparte, por su función, las
 * columnas que la sesión ya no lee de la tabla. Las dos listas de la app se COPIAN de la migración:
 * si alguien cierra o abre una columna en una y no en la otra, la app pediría de la tabla una
 * columna cerrada (42501 y la pantalla sin datos) o dejaría de pedir una abierta.
 */
const leer = (f: string) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8')
const SQL = leer('20270115130000_fix_autorizado_lee_solo_lo_suyo.sql')
/** Las firmas de los documentos del centro (`20270125130000`, 2026-11-17), con la misma forma. */
const SQL_DOCUMENTOS = leer('20270125130000_fix_cierra_gravedad_media.sql')
/** La ficha firmada (`20270128120000`, 2026-11-18): nace cerrada, sin guarda previa de columnas. */
const SQL_FICHA = leer('20270128120000_feat_ficha_firmada.sql')
/** La 10b-3 (`20270129120000`, 2026-11-19) le añade una columna con su GRANT: de qué tutor es el papel. */
const SQL_PUERTAS = leer('20270129120000_feat_ficha_puertas.sql')

/** Las columnas que una migración añade a `tabla` con ALTER TABLE … ADD COLUMN. */
function columnasAnadidas(tabla: string, sql: string): string[] {
  return [
    ...sql.matchAll(
      new RegExp(String.raw`ALTER TABLE public\.${tabla}\s+ADD COLUMN ([a-z_0-9]+)`, 'g')
    ),
  ].map((x) => x[1]!)
}

/** Las columnas del CREATE TABLE de `tabla` (las líneas que empiezan por un nombre y un tipo). */
function columnasDelCreate(tabla: string, sql: string): string[] {
  const m = sql.match(new RegExp(String.raw`CREATE TABLE public\.${tabla} \(([\s\S]*?)\n\);`))
  if (!m) throw new Error(`no encuentro el CREATE TABLE de ${tabla}`)
  return [...m[1]!.matchAll(/^\s{2}([a-z_0-9]+)\s+(?!CHECK)[a-z]/gm)]
    .map((x) => x[1]!)
    .filter((c) => c !== 'constraint')
}

/** Las columnas que devuelve `contenido_firmas_ficha`, sin la que une (`firma_id`). */
function columnasDeLaFuncion(sql: string): string[] {
  const m = sql.match(
    /FUNCTION public\.contenido_firmas_ficha\(p_firma_ids uuid\[\]\)\s+RETURNS TABLE\(([^)]+)\)/
  )
  if (!m) throw new Error('no encuentro contenido_firmas_ficha')
  return m[1]!
    .split(',')
    .map((c) => c.trim().split(/\s+/)[0]!)
    .filter((c) => c !== 'firma_id')
}

/** El ARRAY[...] de la guarda posterior que recorre las columnas cerradas de `tabla`. */
function cerradasEnLaGuarda(tabla: string, sql = SQL): string[] {
  const re = new RegExp(
    String.raw`FOREACH c IN ARRAY ARRAY\[([^\]]+)\] LOOP\s+IF has_column_privilege\('authenticated', 'public\.${tabla}'`
  )
  const m = sql.match(re)
  if (!m) throw new Error(`no encuentro la lista de ${tabla} en la migración`)
  return [...m[1]!.matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]!)
}

/** Las columnas del GRANT SELECT (...) ON public.<tabla>. */
function abiertasEnElGrant(tabla: string, sql = SQL): string[] {
  const m = sql.match(
    new RegExp(String.raw`GRANT SELECT \(([^)]+)\)\s+ON public\.${tabla} TO authenticated`)
  )
  if (!m) throw new Error(`no encuentro el GRANT de ${tabla}`)
  return m[1]!.split(',').map((c) => c.trim())
}

/** Todas las columnas que la guarda previa exige a la tabla. */
function todasEnLaGuardaPrevia(tabla: string, sql = SQL): string[] {
  const m = sql.match(
    new RegExp(
      String.raw`'public\.${tabla}'::regclass AND attnum > 0 AND NOT attisdropped;\s+IF v IS DISTINCT FROM '([a-z0-9_,]+)'`
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

  it('firmas_documentos_centro: COLUMNAS_CONTENIDO_FIRMA_DOCUMENTO = las cerradas, y con el GRANT suman la tabla', () => {
    const cerradas = cerradasEnLaGuarda('firmas_documentos_centro', SQL_DOCUMENTOS)
    // Premisa: la guarda cierra algo (una lista vacía casaría con una app que no pide nada).
    expect(cerradas.length).toBeGreaterThan(0)
    expect([...COLUMNAS_CONTENIDO_FIRMA_DOCUMENTO].sort()).toEqual(cerradas.sort())
    expect(
      [
        ...abiertasEnElGrant('firmas_documentos_centro', SQL_DOCUMENTOS),
        ...COLUMNAS_CONTENIDO_FIRMA_DOCUMENTO,
      ].sort()
    ).toEqual(todasEnLaGuardaPrevia('firmas_documentos_centro', SQL_DOCUMENTOS).sort())
  })

  it('firmas_ficha: COLUMNAS_CONTENIDO_FIRMA_FICHA = las de la función, y con los GRANT y la foto suman la tabla', () => {
    const anadidas = columnasAnadidas('firmas_ficha', SQL_PUERTAS)
    const tabla = [...columnasDelCreate('firmas_ficha', SQL_FICHA), ...anadidas]
    // Premisa: el CREATE TABLE se lee entero (14 columnas, la foto incluida) y la 10b-3 añade una.
    expect(anadidas).toEqual(['tutor_id'])
    expect(tabla).toHaveLength(15)
    expect(tabla).toContain('contenido_cifrado')
    expect([...COLUMNAS_CONTENIDO_FIRMA_FICHA].sort()).toEqual(
      columnasDeLaFuncion(SQL_FICHA).sort()
    )
    // La foto (`contenido_cifrado`) no sale por ninguna puerta de la app: la leerá la 10c.
    expect(
      [
        ...abiertasEnElGrant('firmas_ficha', SQL_FICHA),
        ...abiertasEnElGrant('firmas_ficha', SQL_PUERTAS),
        ...COLUMNAS_CONTENIDO_FIRMA_FICHA,
        'contenido_cifrado',
      ].sort()
    ).toEqual(tabla.sort())
  })
})
