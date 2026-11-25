import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { borrarObjetosBucket } = await import('../storage')

/**
 * Censo C, grupo 1 (2026-11-25): un borrado de Storage que falla no se da por hecho. Antes
 * `borrarObjetosBucket` no miraba el error y devolvía `void`; el olvido, la retención y el
 * expediente seguían como si los ficheros (fotos, DNI, libro de familia) ya no estuvieran.
 */

function cliente(respuesta: { data: unknown; error: { message: string } | null }) {
  const remove = vi.fn(async (_rutas: string[]) => respuesta)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = { storage: { from: vi.fn(() => ({ remove })) } }
  return { c, remove }
}

describe('borrarObjetosBucket', () => {
  it('si Storage da error, lanza (no se da por borrado)', async () => {
    const { c, remove } = cliente({ data: null, error: { message: 'storage caído' } })
    const p = borrarObjetosBucket(c, 'dni-tutores', ['c/n/dni.pdf'])
    await expect(p).rejects.toThrow(/dni-tutores/)
    expect(remove, 'premisa: se le pidió a Storage').toHaveBeenCalledWith(['c/n/dni.pdf'])
  })

  it('sin error, termina sin lanzar', async () => {
    const { c, remove } = cliente({ data: [{ name: 'c/n/dni.pdf' }], error: null })
    await expect(borrarObjetosBucket(c, 'dni-tutores', ['c/n/dni.pdf'])).resolves.toBeUndefined()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('sin rutas (null, vacías), no llama a Storage', async () => {
    const { c, remove } = cliente({ data: null, error: { message: 'no debería llamarse' } })
    await expect(
      borrarObjetosBucket(c, 'dni-tutores', [null, undefined, ''])
    ).resolves.toBeUndefined()
    expect(remove).not.toHaveBeenCalled()
  })
})
