import { describe, expect, it, vi } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

vi.mock('server-only', () => ({}))

const { CAMPOS_FICHA, ORIGENES_LECTURA, ROLES_LECTOR } =
  await import('../queries/get-lecturas-ficha-medica')

/**
 * El registro de lecturas de la ficha médica (`20261128120000`): cada papel, origen y campo que la app
 * conoce tiene su texto en los tres idiomas (next-intl lanza con una clave que falta, y la ficha del
 * niño no saldría). Si la app conoce TODOS los que admite la base lo pregunta a la base
 * `src/test/rls/lecturas-textos-del-check.rls.test.ts` (10c, 2026-11-19): leído de una migración, este
 * test miraba solo la que creó la tabla, y `datos_bloqueados` (20261211120000) entró sin texto en verde.
 */

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

describe('registro de lecturas de la ficha médica', () => {
  for (const [locale, msgs] of LOCALES) {
    it(`${locale}: cada papel, origen y campo tiene su texto`, () => {
      const ns = msgs.ficha_medica_lecturas as Record<string, Record<string, string>>
      for (const [grupo, valores] of [
        ['rol', ROLES_LECTOR],
        ['origen', ORIGENES_LECTURA],
        ['campo', CAMPOS_FICHA],
      ] as const) {
        for (const v of valores) expect(ns[grupo]?.[v]?.trim(), `${grupo}.${v}`).toBeTruthy()
      }
      // El botón de descarga: la familia lo guarda, la Dirección lo entrega.
      const botones = msgs.ficha_medica_lecturas as Record<string, unknown>
      for (const k of ['descargar_guardar', 'descargar']) {
        expect(typeof botones[k] === 'string' && botones[k].trim(), k).toBeTruthy()
      }
    })
  }
})
