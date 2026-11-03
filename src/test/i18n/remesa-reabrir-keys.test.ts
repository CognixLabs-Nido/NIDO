import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'
import { CLAVES_ERROR_REABRIR } from '@/features/remesas/lib/errores-reabrir'

/**
 * Reabrir una remesa (`20261227120000`): cada rechazo llega como una clave de `messages`, y el aviso
 * tiene sus textos en `remesas.reabrir`. Las claves de error salen del propio mapa de la acción;
 * las del aviso, del bloque en castellano, y se exigen en los tres idiomas: una clave nueva sin
 * texto en alguno se pone roja aquí, en vez de pintar el path crudo en el aviso.
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

/** Todas las hojas de un bloque, como claves completas. */
function hojas(prefijo: string, v: unknown): string[] {
  if (typeof v === 'string') return [prefijo]
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) =>
    hojas(`${prefijo}.${k}`, x)
  )
}

const CLAVES_AVISO = hojas(
  'remesas.reabrir',
  (es as { remesas: { reabrir: unknown } }).remesas.reabrir
)

describe('i18n — reabrir una remesa', () => {
  it('premisa: las listas traen lo que se busca', () => {
    expect(CLAVES_ERROR_REABRIR).toContain('remesas.errors.nada_que_reabrir')
    expect(CLAVES_ERROR_REABRIR).toContain('remesas.errors.remesa_cambiada')
    expect(CLAVES_ERROR_REABRIR).toContain('remesas.errors.aviso_incompleto')
    // Los tres casos del aviso y los dos estados que no se tocan.
    for (const c of [
      'caso.enviada',
      'caso.enviada_sin_constancia',
      'caso.fichero_descargado',
      'estado.devuelto',
      'estado.cobrado_manual',
    ])
      expect(CLAVES_AVISO).toContain(`remesas.reabrir.${c}`)
  })

  for (const [locale, msgs] of LOCALES) {
    it.each([...CLAVES_ERROR_REABRIR, ...CLAVES_AVISO])(
      `${locale}: %s existe y no está vacía`,
      (clave) => {
        expect(texto(msgs, clave)?.trim().length ?? 0).toBeGreaterThan(0)
      }
    )
  }

  it('el borrador sin fichero dice por qué: el fichero no se ha generado nunca', () => {
    expect(texto(es as Record<string, unknown>, 'remesas.errors.nada_que_reabrir')).toMatch(
      /^No hay nada que reabrir: el fichero de esta remesa no se ha generado nunca/
    )
  })

  it('la remesa enviada sin fichero guardado dice el síntoma, no una causa', () => {
    expect(
      texto(es as Record<string, unknown>, 'remesas.reabrir.caso.enviada_sin_constancia')
    ).toContain('NIDO no tiene constancia de que su fichero se descargara')
  })
})
