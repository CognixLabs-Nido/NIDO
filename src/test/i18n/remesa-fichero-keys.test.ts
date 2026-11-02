import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * R-1 (`20261220120000`): la descarga del fichero de una remesa contesta tres errores nuevos, que el
 * botón (`RemesaXmlButton`) traduce con `remesas.errors.<código>`. Si falta una clave, next-intl
 * pinta el path crudo en el aviso.
 */
const CODIGOS = ['descarga_en_curso', 'remesa_cambio', 'fichero_alterado'] as const

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

describe('i18n — los errores de la descarga del fichero de una remesa', () => {
  for (const [locale, msgs] of LOCALES) {
    it.each(CODIGOS)(`${locale}: remesas.errors.%s existe y no está vacío`, (c) => {
      const errores = (msgs.remesas as Record<string, Record<string, string>>).errors!
      expect(errores[c]?.trim().length ?? 0).toBeGreaterThan(0)
    })
  }
})
