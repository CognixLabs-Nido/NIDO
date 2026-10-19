// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { sinComentarios } from '../../../scripts/check-centro-activo.mjs'

/**
 * Las notificaciones push van en el idioma de QUIEN LAS RECIBE: se mandan con
 * `enviarPushPorIdioma`, que agrupa a los destinatarios por idioma. Llamar al motor
 * (`enviarPushANotificarUsuarios`) directamente con una lista de destinatarios es mandarles a
 * todos el mismo idioma, que es el fallo que se cerró. Este censo fija quién lo llama: el propio
 * motor, el envío por idioma y el alta de un hermano, que tiene un solo destinatario y ya lee su
 * idioma (lo cubre `vincular-hijo-push-idioma.test.ts`). Un envío nuevo que lo llame se pone rojo
 * aquí y tiene que pasar por `enviarPushPorIdioma`.
 */

const RAIZ = path.resolve(__dirname, '../../..')
const RE_LLAMADA = /\benviarPushANotificarUsuarios\s*\(/g

const LLAMAN_AL_MOTOR: Record<string, string> = {
  'src/features/push/lib/enviar-push.ts': 'lo define',
  'src/features/push/lib/enviar-por-idioma.ts': 'un envío por idioma',
  'src/features/lista-espera/lib/vincular-hijo-tutor-existente.ts':
    'un destinatario, con su idioma',
}

function ficheros(dir: string): string[] {
  const res: string[] = []
  for (const nombre of readdirSync(dir)) {
    const abs = path.join(dir, nombre)
    if (statSync(abs).isDirectory()) {
      if (nombre === '__tests__' || nombre === 'test') continue
      res.push(...ficheros(abs))
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.(ts|tsx)$/.test(nombre)) {
      res.push(path.relative(RAIZ, abs).split(path.sep).join('/'))
    }
  }
  return res
}

function llamadasPorFichero(): Map<string, number> {
  const m = new Map<string, number>()
  for (const rel of ficheros(path.join(RAIZ, 'src'))) {
    const n = (sinComentarios(readFileSync(path.join(RAIZ, rel), 'utf8')).match(RE_LLAMADA) ?? [])
      .length
    if (n > 0) m.set(rel, n)
  }
  return m
}

describe('push en el idioma de quien lo recibe: quién llama al motor', () => {
  it('solo el motor, el envío por idioma y el alta de un hermano, una vez cada uno', () => {
    const llamadas = llamadasPorFichero()
    // Premisa: el censo encuentra la definición del motor (el patrón caza).
    expect(llamadas.get('src/features/push/lib/enviar-push.ts')).toBe(1)
    expect(Object.fromEntries(llamadas)).toEqual(
      Object.fromEntries(Object.keys(LLAMAN_AL_MOTOR).map((f) => [f, 1]))
    )
  })

  it('el patrón caza una llamada partida en varias líneas, y no una en un comentario', () => {
    const codigo = 'await enviarPushANotificarUsuarios (\n  ids,\n  payload\n)\n'
    expect((sinComentarios(codigo).match(RE_LLAMADA) ?? []).length).toBe(1)
    const comentado = '// enviarPushANotificarUsuarios(ids, payload)\nexport const x = 1\n'
    expect((sinComentarios(comentado).match(RE_LLAMADA) ?? []).length).toBe(0)
  })
})
