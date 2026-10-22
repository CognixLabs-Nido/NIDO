import { describe, expect, it } from 'vitest'

import en from '../../../../../messages/en.json'
import es from '../../../../../messages/es.json'
import va from '../../../../../messages/va.json'
import { errorDePlataforma } from '../errores'

/** Cada error de las RPC de plataforma tiene su texto, en los tres idiomas. */
const CASOS: Array<[{ code?: string; hint?: string | null }, string]> = [
  [{ code: '42501' }, 'plataforma.errores.no_autorizado'],
  [{ code: '23505', hint: 'nombre_duplicado' }, 'plataforma.errores.nombre_duplicado'],
  [{ code: '55000', hint: 'centro_con_admin' }, 'plataforma.errores.centro_con_admin'],
  [{ code: '22023', hint: 'email_admin' }, 'plataforma.errores.email_admin'],
  [{ code: '22023', hint: 'datos_centro' }, 'plataforma.errores.datos_invalidos'],
  [{ code: '23514' }, 'plataforma.errores.datos_invalidos'],
  [{ code: 'P0002', hint: 'sin_invitacion' }, 'plataforma.errores.sin_invitacion'],
  [{ code: 'P0002', hint: 'centro' }, 'plataforma.errores.centro_no_existe'],
  [{ code: 'XX000' }, 'plataforma.errores.fallo'],
  [{}, 'plataforma.errores.fallo'],
]

function hoja(mensajes: unknown, clave: string): unknown {
  return clave.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], mensajes)
}

describe('errorDePlataforma', () => {
  it.each(CASOS)('%o → %s', (error, clave) => {
    expect(errorDePlataforma(error)).toBe(clave)
  })

  it('cada clave existe en es, en y va', () => {
    for (const [, clave] of CASOS) {
      for (const m of [es, en, va]) expect(typeof hoja(m, clave), clave).toBe('string')
    }
  })
})
