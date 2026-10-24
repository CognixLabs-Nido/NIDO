import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'
import { filaCargoSchema } from '@/features/recibos/lib/cargo-puntual'

/**
 * Recibos · PR-13 — cargo puntual a varios niños.
 *
 * Las claves se LEEN del código: del diálogo (`t('…')` sobre `cargo_puntual`, `tPanel('…')` sobre
 * `recibos_panel`, y la plantilla `estado_recibo.${…}` expandida con los estados que admite la
 * respuesta de la BD), y de las claves completas que nombran el diálogo, la acción y el esquema.
 * Una clave nueva sin traducir se pone roja sola. Cada traducción lleva los mismos `{marcadores}`
 * que la castellana (los de los plurales incluidos).
 */
const CLAVES = new Set<string>()

function leer(ruta: string): string {
  return readFileSync(join(process.cwd(), ruta), 'utf8')
}

const dialogo = leer('src/features/recibos/components/CargoPuntualDialog.tsx')
for (const m of dialogo.matchAll(/\bt\(\s*'(\w+)'/g)) CLAVES.add(`cargo_puntual.${m[1]!}`)
for (const m of dialogo.matchAll(/\btPanel\(\s*'([\w.]+)'/g)) CLAVES.add(`recibos_panel.${m[1]!}`)
const plantillas = [...dialogo.matchAll(/\btPanel\(\s*`([\w.]+)\$\{/g)].map((m) => m[1]!)
for (const p of new Set(plantillas)) {
  if (p !== 'estado_recibo.')
    throw new Error(`plantilla tPanel(\`${p}\${…}\`) sin catálogo en el test`)
  for (const e of filaCargoSchema.shape.estado.options)
    CLAVES.add(`recibos_panel.estado_recibo.${e}`)
}

for (const ruta of [
  'src/features/recibos/components/CargoPuntualDialog.tsx',
  'src/features/recibos/actions/cargo-puntual.ts',
  'src/features/recibos/lib/cargo-puntual.ts',
]) {
  for (const m of leer(ruta).matchAll(/'((?:cargo_puntual|recibos_panel)\.[\w.]+)'/g)) {
    CLAVES.add(m[1]!)
  }
}

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

function hoja(msgs: Record<string, unknown>, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>(
      (o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined),
      msgs
    )
}

function marcadores(texto: string): string[] {
  return [...new Set([...texto.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]!))].sort()
}

describe('i18n — cargo puntual a varios niños (PR-13)', () => {
  it('premisa: la lectura encuentra el título, el resumen, los estados y los errores', () => {
    expect(plantillas).toContain('estado_recibo.')
    for (const k of [
      'cargo_puntual.titulo',
      'cargo_puntual.resumen_no_incluida_fila',
      'cargo_puntual.elegidos_total',
      'recibos_panel.estado_recibo.pendiente_procesar',
      'recibos_panel.cerrar',
      'recibos_panel.fields.importe',
      'recibos_panel.errors.no_autorizado',
      'cargo_puntual.errors.mes_cerrado',
      'cargo_puntual.errors.a_la_vez',
      'cargo_puntual.errors.sin_resumen',
      'cargo_puntual.errors.sin_ninos',
    ]) {
      expect(CLAVES).toContain(k)
    }
  })

  it('no hay claves de cargo_puntual sin usar', () => {
    const usadas = [...CLAVES].filter((k) => k.startsWith('cargo_puntual.'))
    const definidas: string[] = []
    const recorrer = (o: unknown, pre: string) => {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (typeof v === 'string') definidas.push(`${pre}${k}`)
        else recorrer(v, `${pre}${k}.`)
      }
    }
    recorrer((es as Record<string, unknown>).cargo_puntual, 'cargo_puntual.')
    expect(definidas.sort()).toEqual(usadas.sort())
  })

  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each([...CLAVES])('%s', (k) => {
        const v = hoja(msgs, k)
        expect(typeof v, k).toBe('string')
        expect((v as string).trim()).not.toBe('')
        expect(marcadores(v as string), k).toEqual(marcadores(hoja(es, k) as string))
      })
    })
  }
})
