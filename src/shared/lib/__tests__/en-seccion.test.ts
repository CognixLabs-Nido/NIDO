import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { oNoLeido } from '../en-seccion'
import { LecturaFallida, esLecturaFallida } from '../lectura-fallida'

/**
 * `oNoLeido` (censo C): en una sección, una lectura fallida es `null` («no se pudo leer») y la pantalla
 * sigue; cualquier otro error sigue subiendo. Es la pieza de los layouts y de las seis pantallas diarias.
 */
describe('oNoLeido', () => {
  it('una LecturaFallida es null', async () => {
    const r = await oNoLeido(
      Promise.reject(new LecturaFallida('x', { message: 'timeout' })),
      'prueba'
    )
    expect(r).toBeNull()
  })

  it('una lectura buena devuelve su valor, también un 0 o una lista vacía (eso es «no hay»)', async () => {
    expect(await oNoLeido(Promise.resolve(0), 'prueba')).toBe(0)
    expect(await oNoLeido(Promise.resolve([]), 'prueba')).toEqual([])
  })

  it('otro error no se traga: sigue subiendo', async () => {
    await expect(oNoLeido(Promise.reject(new TypeError('bug')), 'prueba')).rejects.toThrow('bug')
  })

  it('LecturaFallida lleva dónde y el código, sin datos de la fila', () => {
    const e = new LecturaFallida('getAulas', { message: 'permission denied', code: '42501' })
    expect(esLecturaFallida(e)).toBe(true)
    expect(e.donde).toBe('getAulas')
    expect(e.codigo).toBe('42501')
    expect(e.message).toBe('No se pudo leer (getAulas): permission denied')
  })
})
