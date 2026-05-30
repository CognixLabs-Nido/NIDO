import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * F5B-#36 B3 — Salvaguarda contra renames incompletos en i18n.
 *
 * El rename `admin.aulas.fields.cohorte → anio_nacimiento` se hace en
 * 3 archivos JSON + 1 consumer TS. Si me olvido alguno, este test lo
 * detecta sin necesidad de ejecutar la página real.
 *
 * Cobertura:
 *  - `admin.aulas.fields.anio_nacimiento` existe en es/en/va.
 *  - `admin.aulas.fields.cohorte` NO existe en ninguno (rename completo).
 *  - Las 7 nuevas keys de F5B-#36 están en es/en/va:
 *      fields: num_alumnos, profesoras, tecnicos.
 *      personal.tipo: coordinadora, profesora, tecnico, apoyo.
 *      personal.label_coordinadora.
 *  - Nota: NO comparamos textos VA — los marcamos como TODO en el
 *    componente (Decisión D7 PR #36).
 */
const FIELDS_NUEVOS = ['anio_nacimiento', 'num_alumnos', 'profesoras', 'tecnicos'] as const
const PERSONAL_TIPOS = ['coordinadora', 'profesora', 'tecnico', 'apoyo'] as const

interface MessagesShape {
  admin: {
    aulas: {
      fields: Record<string, string>
      personal?: {
        tipo: Record<string, string>
        label_coordinadora: string
      }
    }
  }
}

const LOCALES: ReadonlyArray<[string, MessagesShape]> = [
  ['es', es as unknown as MessagesShape],
  ['en', en as unknown as MessagesShape],
  ['va', va as unknown as MessagesShape],
]

describe('i18n consistency — admin.aulas (F5B-#36)', () => {
  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it('admin.aulas.fields.cohorte fue eliminada (rename completo)', () => {
        expect(msgs.admin.aulas.fields.cohorte).toBeUndefined()
      })

      it.each(FIELDS_NUEVOS)('admin.aulas.fields.%s existe y no está vacío', (key) => {
        const value = msgs.admin.aulas.fields[key]
        expect(value).toBeDefined()
        expect(value!.trim().length).toBeGreaterThan(0)
      })

      it.each(PERSONAL_TIPOS)('admin.aulas.personal.tipo.%s existe y no está vacío', (tipo) => {
        const value = msgs.admin.aulas.personal?.tipo?.[tipo]
        expect(value).toBeDefined()
        expect(value!.trim().length).toBeGreaterThan(0)
      })

      it('admin.aulas.personal.label_coordinadora existe y no está vacío', () => {
        const value = msgs.admin.aulas.personal?.label_coordinadora
        expect(value).toBeDefined()
        expect(value!.trim().length).toBeGreaterThan(0)
      })
    })
  }
})
