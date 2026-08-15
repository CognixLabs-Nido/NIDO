import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import type { MotivoBloqueo } from '@/features/recibos/lib/acceso-modificar'

/**
 * R-5 — salvaguarda i18n de "Modificar". El motivo del bloqueo se pinta como
 * `modificar_bloqueado.<motivo>` a partir del valor que devuelve `accesoModificar`, así que
 * si un día se añade un motivo nuevo y no se traduce, el botón deshabilitado enseñaría el
 * path crudo justo cuando su único trabajo es EXPLICAR por qué no se puede. Los motivos se
 * escriben aquí tipados contra `MotivoBloqueo`: si el union crece, este fichero no compila.
 */
const MOTIVOS: readonly MotivoBloqueo[] = ['en_remesa', 'cobro_avanzado', 'no_confirmado']

const CLAVES = ['modificar', 'desconfirmado_ok', 'desconfirmado_reabre'] as const
const ERRORES = [
  'recibo_en_remesa',
  'recibo_cobrado',
  'no_confirmado',
  'no_encontrado',
  'no_regular',
  'desconfirmar_failed',
] as const

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

function panel(msgs: Record<string, unknown>): Record<string, unknown> {
  return msgs.recibos_panel as Record<string, unknown>
}

describe('i18n consistency — modificar un recibo confirmado (R-5)', () => {
  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each(CLAVES)('recibos_panel.%s existe y no está vacío', (key) => {
        const valor = panel(msgs)[key] as string | undefined
        expect(valor?.trim()).toBeTruthy()
      })

      it.each(MOTIVOS)('recibos_panel.modificar_bloqueado.%s existe y no está vacío', (motivo) => {
        const bloqueos = panel(msgs).modificar_bloqueado as Record<string, string> | undefined
        expect(bloqueos?.[motivo]?.trim()).toBeTruthy()
      })

      it.each(ERRORES)('recibos_panel.errors.%s existe y no está vacío', (key) => {
        const errores = panel(msgs).errors as Record<string, string>
        expect(errores[key]?.trim()).toBeTruthy()
      })
    })
  }
})
