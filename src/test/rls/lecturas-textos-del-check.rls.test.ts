import { beforeAll, describe, expect, it, vi } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { comoPostgres } from './documentos-centro-fixture'
import { checksDeColumnas, leerChecks, sinTexto, sqlChecksDeColumnas } from './valores-del-check'

vi.mock('server-only', () => ({}))

const { CAMPOS_FICHA, ORIGENES_LECTURA, ROLES_LECTOR } =
  await import('@/features/ninos/queries/get-lecturas-ficha-medica')

/**
 * El registro de lecturas de la ficha médica enseña, de cada lectura, el papel, el origen y los campos
 * con su texto (`ficha_medica_lecturas.{rol,origen,campo}`): next-intl lanza con una clave que falta y
 * la sección no saldría. Los valores posibles los pone el CHECK de cada columna, y aquí se le preguntan
 * a la BASE (decisión del 2026-11-19, 10c), no a una migración: hasta la 10c el test los leía del
 * fichero que creó la tabla, y `datos_bloqueados` (20261211120000) entró sin texto con el test en verde.
 * Un valor nuevo sin texto pone esto rojo sin tocar nada más (el control negativo, abajo).
 */
const TABLA = 'public.lecturas_ficha_medica'
const GRUPOS = [
  ['rol_lector', 'rol', ROLES_LECTOR],
  ['origen', 'origen', ORIGENES_LECTURA],
  ['campos', 'campo', CAMPOS_FICHA],
] as const
const LOCALES = [
  ['es', es],
  ['en', en],
  ['va', va],
] as const
const ns = (m: unknown) =>
  (m as { ficha_medica_lecturas: Record<string, Record<string, string> | undefined> })
    .ficha_medica_lecturas

describe('el registro de lecturas: cada valor que admite la base tiene su texto', () => {
  let checks: Map<string, string[][]>
  beforeAll(() => {
    checks = checksDeColumnas(
      TABLA,
      GRUPOS.map(([c]) => c)
    )
  })

  it('premisa: un CHECK de lista por columna, y entre lo de origen, el de la ficha', () => {
    for (const [col] of GRUPOS) expect(checks.get(col)?.length, `${col}: sus CHECK`).toBe(1)
    expect(checks.get('origen')![0]).toContain('ficha')
    expect(checks.get('origen')![0]).toContain('ficha_firmada')
  })

  it('la app conoce exactamente lo que admite la base', () => {
    for (const [col, , app] of GRUPOS) expect([...app].sort(), col).toEqual(checks.get(col)![0])
  })

  for (const [locale, mensajes] of LOCALES) {
    it(`${locale}: cada valor de la base tiene su texto`, () => {
      for (const [col, grupo] of GRUPOS) {
        expect(sinTexto(ns(mensajes), grupo, checks.get(col)![0]!), `${locale} ${grupo}`).toEqual(
          []
        )
      }
    })
  }

  it('control negativo: un origen nuevo en el CHECK, sin tocar nada más, sale sin texto en los tres idiomas', () => {
    const salida = comoPostgres(`BEGIN;
ALTER TABLE public.lecturas_ficha_medica DROP CONSTRAINT lecturas_ficha_medica_origen_check;
ALTER TABLE public.lecturas_ficha_medica ADD CONSTRAINT lecturas_ficha_medica_origen_check
  CHECK (origen = ANY (ARRAY['ficha', 'alta', 'export', 'datos_bloqueados', 'ficha_firmada', 'origen_sonda']));
${sqlChecksDeColumnas(TABLA, ['origen'])}
ROLLBACK;`)
    const origen = leerChecks(salida).get('origen')
    expect(origen?.length).toBe(1)
    expect(origen![0]).toContain('origen_sonda')
    for (const [locale, mensajes] of LOCALES) {
      expect(sinTexto(ns(mensajes), 'origen', origen![0]!), locale).toEqual(['origen_sonda'])
    }
    // Y la base sigue como estaba.
    expect(checksDeColumnas(TABLA, ['origen']).get('origen')![0]).not.toContain('origen_sonda')
  })
})
