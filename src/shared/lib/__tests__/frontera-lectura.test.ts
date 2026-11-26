import { describe, expect, it, vi } from 'vitest'

const errores = vi.hoisted(() => [] as unknown[][])
vi.mock('../logger', () => ({
  logger: { error: (...a: unknown[]) => errores.push(a), warn: () => {} },
}))

import { contadorNoLeido, falloDeLectura } from '../frontera-lectura'
import { LecturaFallida } from '../lectura-fallida'

/**
 * Censo C (decisión de Jose del 2026-11-25): la frontera de las Server Actions. Una `LecturaFallida` sale
 * como `{ success: false }` (o `{ total: null }` en los contadores) y va a Sentry; cualquier otro error
 * (también el `redirect()` de Next) sigue subiendo tal cual.
 */
describe('frontera de las acciones', () => {
  it('falloDeLectura: una LecturaFallida es «no se ha podido leer», con su línea en Sentry', () => {
    errores.length = 0
    const r = falloDeLectura(new LecturaFallida('getX', { message: 'timeout', code: '57014' }))
    expect(r).toEqual({ success: false, error: 'common.lectura_fallida' })
    expect(errores).toHaveLength(1)
    expect(errores[0][1]).toEqual({ code: '57014' })
  })

  it('falloDeLectura: otro error (un redirect de Next) sube tal cual, sin tocar Sentry', () => {
    errores.length = 0
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;/es/login',
    })
    expect(() => falloDeLectura(redirect)).toThrow(redirect)
    expect(errores).toHaveLength(0)
  })

  it('contadorNoLeido: una LecturaFallida da { total: null } («?»), nunca un 0', () => {
    errores.length = 0
    expect(contadorNoLeido(new LecturaFallida('contar', { message: 'x' }))).toEqual({ total: null })
    expect(errores).toHaveLength(1)
  })

  it('contadorNoLeido: otro error sube tal cual', () => {
    const e = new Error('otra cosa')
    expect(() => contadorNoLeido(e)).toThrow(e)
  })
})
