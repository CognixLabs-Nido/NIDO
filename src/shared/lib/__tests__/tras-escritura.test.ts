import { describe, expect, it, vi } from 'vitest'

const errores = vi.hoisted(() => [] as unknown[][])
vi.mock('../logger', () => ({
  logger: { error: (...a: unknown[]) => errores.push(a), warn: () => {} },
}))

import { LecturaFallida } from '../lectura-fallida'
import { siFallaTrasEscribir } from '../tras-escritura'

/**
 * Censo C (2026-11-25): una lectura después de una escritura hecha no convierte lo guardado en «no se
 * guardó». Recoge solo `LecturaFallida`, con su valor por defecto y su línea en Sentry.
 */
describe('siFallaTrasEscribir', () => {
  it('premisa: la lectura buena devuelve su valor', async () => {
    expect(
      await siFallaTrasEscribir('x', Promise.resolve(new Map([['a', 'u']])), new Map())
    ).toEqual(new Map([['a', 'u']]))
  })

  it('una LecturaFallida da el valor por defecto y va a Sentry', async () => {
    errores.length = 0
    const r = await siFallaTrasEscribir(
      'firmar la vista previa',
      Promise.reject(new LecturaFallida('firmarRutas', { message: 'timeout', code: 'X1' })),
      new Map<string, string>()
    )
    expect(r).toEqual(new Map())
    expect(errores).toHaveLength(1)
    expect(String(errores[0]![0])).toContain('firmar la vista previa')
  })

  it('otro error no se traga: sigue subiendo', async () => {
    await expect(
      siFallaTrasEscribir('x', Promise.reject(new Error('otra cosa')), null)
    ).rejects.toThrow('otra cosa')
  })
})
