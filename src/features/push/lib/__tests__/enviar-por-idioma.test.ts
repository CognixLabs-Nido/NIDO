import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PushPayload } from '@/features/push/types'

/**
 * La notificación va en el idioma de QUIEN LA RECIBE: `enviarPushPorIdioma` agrupa a los
 * destinatarios por `usuarios.idioma_preferido`, construye la notificación una vez por idioma y
 * hace un envío por grupo.
 */

const h = vi.hoisted(() => ({
  idiomas: new Map<string, string>(),
  enviar: vi.fn(async (ids: string[], _payload: PushPayload) => ({
    enviados: ids.length,
    expirados: 0,
    errores: 0,
    total: ids.length,
  })),
}))

vi.mock('../audiencia', () => ({
  idiomasDeUsuarios: vi.fn(async () => h.idiomas),
}))
vi.mock('../enviar-push', () => ({ enviarPushANotificarUsuarios: h.enviar }))

const { enviarPushPorIdioma } = await import('../enviar-por-idioma')

const construir = (idioma: string) => ({
  titulo: `titulo-${idioma}`,
  cuerpo: `cuerpo-${idioma}`,
  url: `/${idioma}/messages`,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.idiomas = new Map()
})

describe('enviarPushPorIdioma', () => {
  it('un envío por idioma, cada uno con su título, su texto y su enlace', async () => {
    h.idiomas = new Map([
      ['tutora-es', 'es'],
      ['tutor-va', 'va'],
      ['profe-en', 'en'],
      ['otra-va', 'va'],
    ])
    const r = await enviarPushPorIdioma(['tutora-es', 'tutor-va', 'profe-en', 'otra-va'], construir)

    const envios = h.enviar.mock.calls.map(([ids, payload]) => ({ ids, payload }))
    expect(envios).toHaveLength(3)
    expect(envios).toEqual(
      expect.arrayContaining([
        { ids: ['tutora-es'], payload: construir('es') },
        { ids: ['tutor-va', 'otra-va'], payload: construir('va') },
        { ids: ['profe-en'], payload: construir('en') },
      ])
    )
    // Suma los resúmenes de los tres envíos.
    expect(r).toEqual({ enviados: 4, expirados: 0, errores: 0, total: 4 })
  })

  it('quien no tiene idioma conocido recibe el de por defecto', async () => {
    h.idiomas = new Map([['tutor-va', 'va']])
    await enviarPushPorIdioma(['tutor-va', 'sin-perfil'], construir)
    expect(h.enviar).toHaveBeenCalledWith(['sin-perfil'], construir('es'))
    expect(h.enviar).toHaveBeenCalledWith(['tutor-va'], construir('va'))
  })

  it('un grupo que falla no impide los demás', async () => {
    h.idiomas = new Map([
      ['tutor-va', 'va'],
      ['tutora-es', 'es'],
    ])
    const r = await enviarPushPorIdioma(['tutor-va', 'tutora-es'], (idioma) => {
      if (idioma === 'va') throw new Error('traducción rota')
      return construir(idioma)
    })
    expect(h.enviar).toHaveBeenCalledTimes(1)
    expect(h.enviar).toHaveBeenCalledWith(['tutora-es'], construir('es'))
    expect(r).toEqual({ enviados: 1, expirados: 0, errores: 1, total: 1 })
  })

  it('sin destinatarios no consulta idiomas ni envía', async () => {
    const r = await enviarPushPorIdioma([], construir)
    expect(h.enviar).not.toHaveBeenCalled()
    expect(r).toEqual({ enviados: 0, expirados: 0, errores: 0, total: 0 })
  })
})
