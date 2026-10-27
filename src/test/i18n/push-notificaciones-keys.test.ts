import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * Los textos de las notificaciones push se traducen al idioma de QUIEN LAS RECIBE
 * (`enviarPushPorIdioma`), así que cada uno tiene que existir en los tres idiomas: next-intl
 * LANZA con una clave ausente, y el envío de ese idioma se perdería. Y cada traducción lleva los
 * mismos huecos (`{titulo}`, `{nombre}`) que la castellana.
 */
const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

const CLAVES: ReadonlyArray<string> = [
  'push.notificaciones.anuncio_centro_titulo',
  'push.notificaciones.anuncio_aula_titulo',
  'push.notificaciones.anuncio_cuerpo',
  'push.notificaciones.mensaje_cuerpo',
  'eventos.push.actualizado',
  'eventos.push.cancelado',
  'admin.admisiones.anadirHijo.push_titulo',
  'admin.admisiones.anadirHijo.push_cuerpo',
]

function valor(msgs: Record<string, unknown>, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], msgs)
}

const huecos = (texto: string) => [...texto.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('i18n — textos de las notificaciones push', () => {
  for (const clave of CLAVES) {
    it(`${clave}: en los tres idiomas, con los mismos huecos`, () => {
      const castellano = valor(es as Record<string, unknown>, clave)
      expect(typeof castellano, `es: ${clave}`).toBe('string')
      for (const [locale, msgs] of LOCALES) {
        const texto = valor(msgs, clave)
        expect(typeof texto, `${locale}: ${clave}`).toBe('string')
        expect((texto as string).length).toBeGreaterThan(0)
        expect(huecos(texto as string), `${locale}: ${clave}`).toEqual(huecos(castellano as string))
      }
    })
  }

  // F11-B, punto 8: la notificación se ve en la pantalla bloqueada. El aviso de un mensaje, de
  // un anuncio y del alta de un hermano no lleva ningún dato: ni el texto ni el nombre del niño.
  it.each([
    'push.notificaciones.mensaje_cuerpo',
    'push.notificaciones.anuncio_cuerpo',
    'admin.admisiones.anadirHijo.push_titulo',
    'admin.admisiones.anadirHijo.push_cuerpo',
  ])('%s no tiene huecos: no lleva ningún dato', (clave) => {
    expect(huecos(valor(es as Record<string, unknown>, clave) as string)).toEqual([])
  })

  it('el texto de cancelar lleva el título del evento', () => {
    expect(
      huecos(valor(es as Record<string, unknown>, 'eventos.push.cancelado') as string)
    ).toEqual(['titulo'])
  })
})
