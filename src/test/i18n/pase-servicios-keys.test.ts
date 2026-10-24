import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'
import { SERVICIOS_DEL_DIA } from '@/features/parte-servicio/lib/pase-servicios'

/**
 * Recibos · PR-12 — el listado único del pase de servicios.
 *
 * Las claves se LEEN del código: del componente (`t('…')` sobre `parte_servicio.listado`, y la
 * plantilla `col_${…}` expandida con `SERVICIOS_DEL_DIA`), de la página, de la acción y del menú.
 * Una clave nueva sin traducir se pone roja sola. Cada traducción lleva los mismos `{marcadores}`
 * que la castellana (los de los plurales incluidos).
 */
const CLAVES = new Set<string>()

function leer(ruta: string): string {
  return readFileSync(join(process.cwd(), ruta), 'utf8')
}

const componente = leer('src/features/parte-servicio/components/PaseServiciosCliente.tsx')
for (const m of componente.matchAll(/\bt\(\s*'(\w+)'/g))
  CLAVES.add(`parte_servicio.listado.${m[1]!}`)
for (const m of componente.matchAll(/\btServicio\(\s*'(\w+)'/g))
  CLAVES.add(`parte_servicio.${m[1]!}`)
const plantillas = [...componente.matchAll(/\bt\(\s*`(\w+)\$\{/g)].map((m) => m[1]!)
for (const p of new Set(plantillas)) {
  if (p !== 'col_') throw new Error(`plantilla t(\`${p}\${…}\`) sin catálogo en el test`)
  for (const s of SERVICIOS_DEL_DIA) CLAVES.add(`parte_servicio.listado.col_${s}`)
}

const pagina = leer('src/app/[locale]/teacher/servicios/page.tsx')
for (const m of pagina.matchAll(/\bt\(\s*'([\w.]+)'/g)) CLAVES.add(`parte_servicio.${m[1]!}`)

const accion = leer('src/features/parte-servicio/actions/guardar-pase-servicios.ts')
for (const m of accion.matchAll(/'(parte_servicio\.[\w.]+)'/g)) CLAVES.add(m[1]!)
const schema = leer('src/features/parte-servicio/schemas/parte-servicio.ts')
for (const m of schema.matchAll(/'(parte_servicio\.[\w.]+)'/g)) CLAVES.add(m[1]!)

CLAVES.add('teacher.nav.servicios')
CLAVES.add('admin.nav.servicios')

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

describe('i18n — listado único del pase de servicios (PR-12)', () => {
  it('premisa: la lectura encuentra las columnas, el guardado, el error de mes cerrado y el menú', () => {
    expect(plantillas).toContain('col_')
    for (const k of [
      'parte_servicio.listado.col_matinera',
      'parte_servicio.listado.col_vespertina',
      'parte_servicio.listado.cambios',
      'parte_servicio.listado.descartar_cambios',
      'parte_servicio.listado.error',
      'parte_servicio.guardar',
      'parte_servicio.title',
      'parte_servicio.errors.mes_cerrado',
      'parte_servicio.errors.sin_permiso',
      'parte_servicio.validation.fecha_invalida',
    ]) {
      expect(CLAVES).toContain(k)
    }
  })

  it('el menú lleva al listado único, para la profe y para Dirección', () => {
    const menu = leer('src/shared/lib/sidebar-items.tsx')
    expect(menu.match(/\/teacher\/servicios`/g) ?? []).toHaveLength(2)
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
