import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { componerResumenRecalculo } from '@/features/recibos/lib/resumen-recalculo'

/**
 * R-1 — salvaguarda i18n del botón "Recalcular el mes".
 *
 * Las frases del aviso se eligen en runtime (`componerResumenRecalculo` devuelve claves),
 * así que un olvido en un idioma no lo caza el typecheck: next-intl renderiza el path
 * crudo. Se comprueban las claves fijas del botón/diálogo y, además, TODAS las que el
 * compositor puede llegar a emitir, derivadas de él y no de una lista copiada a mano.
 */
const FIJAS = [
  'recalcular',
  'recalcular_confirm_title',
  'recalcular_confirm_desc',
  'recalcular_confirmar',
  'recalculo_titulo',
] as const

/** Todas las combinaciones que hacen variar las frases emitidas. */
const CASOS = [
  { conceptosSembrados: 0, ninosAfectados: 0, familiasAfectadas: 0 },
  { conceptosSembrados: 3, ninosAfectados: 2, familiasAfectadas: 0 },
  { conceptosSembrados: 4, ninosAfectados: 2, familiasAfectadas: 1 },
]

const EMITIDAS = [
  ...new Set(
    CASOS.flatMap((c) =>
      componerResumenRecalculo({
        ...c,
        recibosRegenerados: 5,
        confirmadosIntactos: 2,
      }).map((f) => f.clave)
    )
  ),
]

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

function panel(msgs: Record<string, unknown>): Record<string, string> {
  return msgs.recibos_panel as Record<string, string>
}

/**
 * `createTranslator` tipa las claves como literales del fichero de mensajes. Aquí son
 * dinámicas A PROPÓSITO: la gracia del test es que las emite el compositor en runtime,
 * que es justo donde un olvido se escapa al typecheck. Se ensancha la firma en un solo
 * sitio en vez de salpicar casts por los asserts.
 */
type Traductor = (clave: string, valores?: Record<string, number>) => string

function traductor(locale: string, msgs: Record<string, unknown>): Traductor {
  return createTranslator({
    locale,
    messages: msgs,
    namespace: 'recibos_panel',
  }) as unknown as Traductor
}

describe('i18n consistency — recalcular el mes (R-1)', () => {
  it('el compositor emite las 5 frases posibles (si no, el barrido de abajo miente)', () => {
    expect(EMITIDAS).toHaveLength(5)
  })

  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each([...FIJAS, ...EMITIDAS])('recibos_panel.%s existe y no está vacío', (key) => {
        const valor = panel(msgs)[key]
        expect(valor).toBeDefined()
        expect(valor!.trim().length).toBeGreaterThan(0)
      })

      it.each([
        ['recalculo_conceptos', ['conceptos', 'ninos']],
        ['recalculo_familias', ['familias']],
        ['recalculo_recibos', ['recibos']],
        ['recalculo_confirmados', ['confirmados']],
        ['recalcular_confirm_desc', ['borradores', 'confirmados']],
      ] as const)('%s interpola sus variables', (key, vars) => {
        // Las frases numéricas van con plural ICU (`{n, plural, …}`), así que se busca la
        // variable, no la llave cerrada: `{recibos}` ya no aparece literal.
        for (const v of vars) expect(panel(msgs)[key]).toMatch(new RegExp(`\\{${v}[,}]`))
      })

      it('la frase de "nada que sembrar" NO lleva placeholders (no debe imprimir un 0)', () => {
        expect(panel(msgs).recalculo_conceptos_ninguno).not.toContain('{')
      })

      it('el aviso RENDERIZA (ICU válido) y concuerda en singular', () => {
        // No basta con que la clave exista: una llave mal cerrada en el ICU peta en runtime.
        // Se renderiza de verdad con next-intl y se comprueba que en 1 no dice "1 recibos".
        const t = traductor(locale, msgs)
        const aviso = componerResumenRecalculo({
          conceptosSembrados: 1,
          ninosAfectados: 1,
          familiasAfectadas: 1,
          recibosRegenerados: 1,
          confirmadosIntactos: 1,
        })
          .map((f) => t(f.clave, f.valores))
          .join(' · ')

        expect(aviso.length).toBeGreaterThan(0)
        expect(aviso).not.toMatch(/recalculo_/) // path crudo = clave ausente
        expect(aviso).not.toMatch(/\{|\}/) // ICU sin resolver
        expect(aviso).toContain('1')
      })

      it('con todo a cero el aviso no muestra un "0" a secas para los conceptos', () => {
        const t = traductor(locale, msgs)
        const aviso = componerResumenRecalculo({
          conceptosSembrados: 0,
          ninosAfectados: 0,
          familiasAfectadas: 0,
          recibosRegenerados: 0,
          confirmadosIntactos: 0,
        })
          .map((f) => t(f.clave, f.valores))
          .join(' · ')

        expect(aviso).toBe(
          [
            t('recalculo_conceptos_ninguno'),
            t('recalculo_recibos', { recibos: 0 }),
            t('recalculo_confirmados', { confirmados: 0 }),
          ].join(' · ')
        )
        expect(aviso).not.toMatch(/(^|[\s·])0([\s·]|$)/)
      })
    })
  }
})
