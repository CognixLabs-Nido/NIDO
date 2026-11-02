import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'
import { CLAVES_ERROR_MARCAR_ENVIADA } from '@/features/remesas/lib/errores-marcar-enviada'

/**
 * R-4 (`20261221120000`): cada rechazo de marcar enviada llega al panel como una clave de
 * `messages` que dice qué hacer. La lista sale del propio mapa de la acción: una clave nueva sin
 * texto en algún idioma se pone roja aquí, en vez de pintar el path crudo en el aviso.
 */
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

describe('i18n — los errores de marcar enviada una remesa', () => {
  it('premisa: la lista trae las dos nuevas de R-4', () => {
    expect(CLAVES_ERROR_MARCAR_ENVIADA).toContain('remesas.errors.sin_fichero')
    expect(CLAVES_ERROR_MARCAR_ENVIADA).toContain('remesas.errors.fichero_no_coincide')
  })

  for (const [locale, msgs] of LOCALES) {
    it.each([...CLAVES_ERROR_MARCAR_ENVIADA])(`${locale}: %s existe y no está vacía`, (clave) => {
      expect(texto(msgs, clave)?.trim().length ?? 0).toBeGreaterThan(0)
    })
  }

  it('la de sin fichero dice qué hacer: descargarlo, subirlo al banco y volver a marcarla', () => {
    expect(texto(es as Record<string, unknown>, 'remesas.errors.sin_fichero')).toBe(
      'Falta descargar el fichero: descárgalo, súbelo al banco y vuelve a marcarla enviada.'
    )
  })
})
