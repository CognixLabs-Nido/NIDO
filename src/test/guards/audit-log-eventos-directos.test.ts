// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Nada entra en audit_log que la redacción de la purga RGPD no sepa limpiar. Casi todo entra por
 * `audit_trigger_function`, cuyas tablas y columnas están en `data-model.md`. Un evento que una
 * función escribe DIRECTAMENTE en audit_log (sin trigger, p. ej. la entrada del superusuario a un
 * centro, ADR-0061) no sale en esa lista: este test exige que cada uno esté dado de alta en
 * `data-model.md`, en una línea que diga qué hace la purga con él.
 */

const RAIZ = path.resolve(__dirname, '../../..')
const MIGRACIONES = path.join(RAIZ, 'supabase/migrations')
const RE_INSERT =
  /INSERT\s+INTO\s+(?:public\.)?audit_log\s*\(\s*tabla\b[^)]*\)\s*VALUES\s*\(\s*'([a-z_]+)'/gi

function eventosDirectos(sql: string): string[] {
  return [...sql.matchAll(RE_INSERT)].map((m) => m[1])
}

describe('audit_log: los eventos que no vienen del trigger están en el doc de la purga', () => {
  it('cada evento escrito directamente tiene su línea en data-model.md, con la purga', () => {
    const eventos = new Set<string>()
    for (const f of readdirSync(MIGRACIONES).filter((n) => n.endsWith('.sql'))) {
      for (const e of eventosDirectos(readFileSync(path.join(MIGRACIONES, f), 'utf8')))
        eventos.add(e)
    }
    // Premisa: el censo encuentra la entrada del superusuario (el patrón caza).
    expect([...eventos]).toContain('entrada_superusuario')
    const doc = readFileSync(path.join(RAIZ, 'docs/architecture/data-model.md'), 'utf8').split('\n')
    const sinDoc = [...eventos].filter(
      (e) => !doc.some((linea) => linea.includes(`\`${e}\``) && /purga/i.test(linea))
    )
    expect(sinDoc).toEqual([])
  })

  it('el patrón caza un INSERT partido en líneas y no el del trigger, que no lleva tabla literal', () => {
    const directo =
      "INSERT INTO public.audit_log (tabla, registro_id)\n  VALUES ('evento_x', v_id);"
    expect(eventosDirectos(directo)).toEqual(['evento_x'])
    const trigger =
      'INSERT INTO public.audit_log\n    (tabla, registro_id)\n  VALUES\n    (TG_TABLE_NAME, v_registro_id);'
    expect(eventosDirectos(trigger)).toEqual([])
  })
})
