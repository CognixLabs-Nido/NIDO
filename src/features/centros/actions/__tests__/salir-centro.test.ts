import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * «Salir del centro» del aviso de superusuario: borra la cookie del centro activo y vuelve al
 * panel de plataforma (Fase 5). No escribe nada más.
 */

const estado = vi.hoisted(() => ({
  borradas: [] as string[],
  escritas: [] as string[],
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    delete: (nombre: string) => estado.borradas.push(nombre),
    set: (nombre: string) => estado.escritas.push(nombre),
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

const { salirDelCentro } = await import('../salir-centro')

beforeEach(() => {
  estado.borradas = []
  estado.escritas = []
})

describe('salirDelCentro', () => {
  it('borra la cookie del centro activo y vuelve al panel en su idioma', async () => {
    await expect(salirDelCentro('va')).rejects.toThrow('REDIRECT:/va/plataforma')
    expect(estado.borradas).toEqual(['nido_centro_activo'])
    expect(estado.escritas).toEqual([])
  })

  it('un idioma que no existe: también sale, al panel en castellano', async () => {
    await expect(salirDelCentro('https://otro.example')).rejects.toThrow('REDIRECT:/es/plataforma')
    expect(estado.borradas).toEqual(['nido_centro_activo'])
  })
})
