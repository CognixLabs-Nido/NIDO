import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'
import { RECUENTOS } from '@/features/plataforma/components/TarjetaCentro'
import { ALERTAS_CENTRO } from '@/features/plataforma/types'

/**
 * Fase 5 — el panel de plataforma. next-intl LANZA con clave ausente: el panel reventaría en el
 * idioma al que le falte. Las claves de los recuentos y de las alertas salen de las listas que
 * pinta la tarjeta, no de una copia: una métrica o una alerta nueva entra sola aquí.
 */
type Mensajes = Record<string, unknown>
const LOCALES: ReadonlyArray<[string, Mensajes]> = [
  ['es', es as Mensajes],
  ['en', en as Mensajes],
  ['va', va as Mensajes],
]

function hojas(obj: unknown, prefijo = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefijo]
  return Object.entries(obj as Mensajes).flatMap(([k, v]) =>
    hojas(v, prefijo ? `${prefijo}.${k}` : k)
  )
}

describe('i18n — panel de plataforma', () => {
  const claves = hojas((es as Mensajes).plataforma)

  it('los tres idiomas tienen las mismas claves en plataforma, y no vacías', () => {
    // Premisa: el espacio existe y tiene claves (si no, «iguales» sería trivial).
    expect(claves.length).toBeGreaterThan(10)
    for (const [loc, msgs] of LOCALES) {
      expect(hojas(msgs.plataforma).sort(), loc).toEqual([...claves].sort())
      for (const c of claves) {
        const valor = c.split('.').reduce<unknown>((a, k) => (a as Mensajes)?.[k], msgs.plataforma)
        expect(typeof valor === 'string' && valor.length > 0, `${loc}: plataforma.${c}`).toBe(true)
      }
    }
  })

  it('cada recuento y cada alerta de la tarjeta tiene su texto', () => {
    for (const [clave] of RECUENTOS) expect(claves).toContain(`metricas.${clave}`)
    for (const a of ALERTAS_CENTRO) expect(claves).toContain(`alertas.${a}`)
    expect(claves).toContain('alertas.titulo')
  })
})
