// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { CODIGOS_AVISO, CODIGOS_BLOQUEO } from '../lib/falta'

/**
 * Los códigos de lo que falta salen de la BD (`privado.olvido_bloqueos`) y la app los traduce. Si
 * la migración añade uno que la app no conoce, la lista no lo enseña: este test lo caza leyendo
 * los códigos de la propia migración. Y cada código y cada aviso por correo existen en es/en/va.
 */

// La última definición de `privado.olvido_bloqueos`: si una migración la reescribe con un código
// más, el test lo ve. Leer un fichero fijo dejaba de mirar en cuanto otra la reescribía.
const MIGRACIONES = path.resolve(__dirname, '../../../../supabase/migrations')
const ANCLA = /CREATE (?:OR REPLACE )?FUNCTION privado\.olvido_bloqueos\(/
const FICHERO = readdirSync(MIGRACIONES)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => ANCLA.test(readFileSync(path.join(MIGRACIONES, f), 'utf8')))
  .at(-1)
const MIGRACION = (() => {
  if (!FICHERO) return ''
  const sql = readFileSync(path.join(MIGRACIONES, FICHERO), 'utf8')
  const desde = sql.search(ANCLA)
  const cuerpo = sql.indexOf('$function$', desde)
  return sql.slice(desde, sql.indexOf('$function$', cuerpo + 1))
})()

function codigosDe(tipo: 'v_bloqueos' | 'v_avisos'): string[] {
  const re = new RegExp(`${tipo} := ${tipo} \\|\\| jsonb_build_object\\('codigo', '(\\w+)'`, 'g')
  return [...MIGRACION.matchAll(re)].map((m) => m[1]!)
}

const LOCALES = [
  ['es', es],
  ['en', en],
  ['va', va],
] as const

const EVENTOS = ['pedida', 'confirmada', 'rechazada', 'retirada', 'deshecha', 'borrada']

describe('olvido: los códigos de lo que falta', () => {
  it('lee la última migración que define la función, y la función entera', () => {
    expect(FICHERO).toBeDefined()
    expect(MIGRACION).toMatch(/^CREATE OR REPLACE FUNCTION privado\.olvido_bloqueos\(/)
    expect(MIGRACION).toContain(
      "RETURN jsonb_build_object('bloqueos', v_bloqueos, 'avisos', v_avisos);"
    )
  })

  it('la app conoce exactamente los que escribe la migración', () => {
    // Premisa: el patrón encuentra códigos (si no, la igualdad pasaría con dos listas vacías).
    expect(codigosDe('v_bloqueos').length).toBeGreaterThan(0)
    expect(codigosDe('v_bloqueos').sort()).toEqual([...CODIGOS_BLOQUEO].sort())
    expect(codigosDe('v_avisos').sort()).toEqual([...CODIGOS_AVISO].sort())
  })

  it.each(LOCALES)('%s traduce cada código, cada estado y cada correo', (_l, m) => {
    const o = m.olvido as unknown as Record<string, Record<string, string>>
    for (const c of [...CODIGOS_BLOQUEO, ...CODIGOS_AVISO]) expect(o.falta![c]).toBeTruthy()
    for (const e of ['pendiente', 'confirmada', 'rechazada', 'retirada', 'borrada'])
      expect(o.estado![e]).toBeTruthy()
    for (const e of EVENTOS) expect(o.correo![`texto_${e}`]).toContain('{centro}')
  })

  it.each(LOCALES)('%s: la push a la titular no tiene huecos (no lleva nombres)', (_l, m) => {
    const p = m.push.notificaciones as Record<string, string>
    expect(p.olvido_titulo).toBeTruthy()
    expect(p.olvido_cuerpo).toBeTruthy()
    expect(`${p.olvido_titulo}${p.olvido_cuerpo}`).not.toMatch(/\{\w+\}/)
  })
})
