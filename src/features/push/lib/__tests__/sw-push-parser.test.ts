import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

/**
 * Tests del parser de `public/sw.js` (item 5 — hotfix blindaje por-campo).
 *
 * `sw.js` es un Service Worker estático (no bundleado), así que no se puede
 * importar como módulo. Lo cargamos como texto y lo ejecutamos con un `self`
 * mockeado vía `new Function`, capturando el listener `push` real y
 * ejercitándolo. Verificamos que CUALQUIER payload (válido, sin título,
 * campos null/vacíos, JSON corrupto, null, tipos erróneos) produce una
 * notificación con título y cuerpo no vacíos — nunca rompe ni queda en blanco.
 */

// vitest corre con cwd = raíz del repo; `process.cwd()` localiza public/ de
// forma fiable (import.meta.url no es file:// bajo la transformación de vite).
const swCode = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')

interface PushListener {
  (event: { data: unknown; waitUntil: (p: unknown) => void }): void
}

interface NotifOptions {
  body: string
  tag?: string
  data: { url: string; [k: string]: unknown }
}

function loadSw() {
  const listeners: Record<string, PushListener> = {}
  const showNotification = vi.fn((_titulo: string, _options: NotifOptions) => Promise.resolve())
  const self = {
    addEventListener: (type: string, fn: PushListener) => {
      listeners[type] = fn
    },
    skipWaiting: () => {},
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve([]),
      openWindow: () => Promise.resolve(null),
    },
    registration: { showNotification },
    location: { href: 'https://nido.example/sw.js' },
  }
  new Function('self', 'console', swCode)(self, { error: () => {}, log: () => {} })
  return { push: listeners.push!, showNotification }
}

function dispatch(data: unknown) {
  const { push, showNotification } = loadSw()
  push({ data, waitUntil: () => {} })
  return showNotification
}

const TITULO_DEFAULT = 'NIDO'
const CUERPO_DEFAULT = 'Tienes una notificación nueva'

describe('sw.js push parser', () => {
  it('payload válido: usa título, cuerpo, url y tag de la conversación', () => {
    const sn = dispatch({
      json: () => ({
        titulo: 'Mensaje de Ana',
        cuerpo: 'Hola familia',
        url: '/es/messages/conversacion/c1',
        datos: { conversacion_id: 'c1' },
      }),
    })
    expect(sn).toHaveBeenCalledTimes(1)
    const [titulo, options] = sn.mock.calls[0]!
    expect(titulo).toBe('Mensaje de Ana')
    expect(options.body).toBe('Hola familia')
    expect(options.tag).toBe('c1')
    expect(options.data.url).toBe('/es/messages/conversacion/c1')
  })

  it('sin título: cae al título por defecto, conserva cuerpo', () => {
    const [titulo, options] = dispatch({ json: () => ({ cuerpo: 'solo cuerpo' }) }).mock.calls[0]!
    expect(titulo).toBe(TITULO_DEFAULT)
    expect(options.body).toBe('solo cuerpo')
  })

  it('campos null/vacíos: defaults seguros (no notificación en blanco)', () => {
    const [titulo, options] = dispatch({
      json: () => ({ titulo: '', cuerpo: null, url: '' }),
    }).mock.calls[0]!
    expect(titulo).toBe(TITULO_DEFAULT)
    expect(options.body).toBe(CUERPO_DEFAULT)
    expect(options.data.url).toBe('/')
  })

  it('tipos erróneos (número en título/cuerpo): defaults seguros', () => {
    const [titulo, options] = dispatch({
      json: () => ({ titulo: 42, cuerpo: 99 }),
    }).mock.calls[0]!
    expect(titulo).toBe(TITULO_DEFAULT)
    expect(options.body).toBe(CUERPO_DEFAULT)
  })

  it('JSON corrupto: cae a text() como cuerpo, título por defecto, no rompe', () => {
    const [titulo, options] = dispatch({
      json: () => {
        throw new Error('JSON malformado')
      },
      text: () => 'texto plano de respaldo',
    }).mock.calls[0]!
    expect(titulo).toBe(TITULO_DEFAULT)
    expect(options.body).toBe('texto plano de respaldo')
  })

  it('payload null: defaults', () => {
    const [titulo, options] = dispatch({ json: () => null }).mock.calls[0]!
    expect(titulo).toBe(TITULO_DEFAULT)
    expect(options.body).toBe(CUERPO_DEFAULT)
  })

  it('sin event.data: defaults, igualmente muestra notificación', () => {
    const sn = dispatch(null)
    expect(sn).toHaveBeenCalledTimes(1)
    const [titulo, options] = sn.mock.calls[0]!
    expect(titulo).toBe(TITULO_DEFAULT)
    expect(options.body).toBe(CUERPO_DEFAULT)
  })

  it('payload no-objeto (array): defaults, sin tag', () => {
    const [titulo, options] = dispatch({ json: () => [1, 2, 3] }).mock.calls[0]!
    expect(titulo).toBe(TITULO_DEFAULT)
    expect(options.tag).toBeUndefined()
  })
})
