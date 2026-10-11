import { describe, expect, it, vi } from 'vitest'

import { comprobarBdLocal, esUrlLocal } from './guarda-bd-local'

const PROD = 'https://ttroedkdgomfmohgojvg.supabase.co'

describe('guarda de BD local de la suite RLS', () => {
  it('deja pasar la BD efímera de supabase start', () => {
    expect(comprobarBdLocal({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' })).toBe('local')
    expect(comprobarBdLocal({ NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' })).toBe('local')
    expect(comprobarBdLocal({ NEXT_PUBLIC_SUPABASE_URL: 'http://[::1]:54321' })).toBe('local')
  })

  it('aborta contra producción, con la URL en el mensaje', () => {
    expect(() => comprobarBdLocal({ NEXT_PUBLIC_SUPABASE_URL: PROD })).toThrow(
      `la suite RLS solo corre contra BD local; apuntabas a ${PROD}`
    )
  })

  it('aborta si la URL falta o no se entiende', () => {
    expect(() => comprobarBdLocal({})).toThrow('NEXT_PUBLIC_SUPABASE_URL vacía')
    expect(() => comprobarBdLocal({ NEXT_PUBLIC_SUPABASE_URL: '127.0.0.1:54321' })).toThrow(
      'solo corre contra BD local'
    )
  })

  it('no se deja engañar por un host que solo contiene "localhost" o "127.0.0.1"', () => {
    expect(esUrlLocal('https://localhost.ejemplo.com')).toBe(false)
    expect(esUrlLocal('https://127.0.0.1.nip.io')).toBe(false)
    expect(esUrlLocal(`${PROD}/?h=127.0.0.1`)).toBe(false)
  })

  it('RLS_ALLOW_REMOTE=1 la salta, y avisa', () => {
    const avisar = vi.fn()
    expect(
      comprobarBdLocal({ NEXT_PUBLIC_SUPABASE_URL: PROD, RLS_ALLOW_REMOTE: '1' }, avisar)
    ).toBe('remoto-permitido')
    expect(avisar).toHaveBeenCalledOnce()
    expect(avisar.mock.calls[0]?.[0]).toContain(`escribir fixtures en ${PROD}`)
  })

  it('solo RLS_ALLOW_REMOTE=1 exacto la salta', () => {
    for (const v of ['true', 'yes', '0', '']) {
      expect(() =>
        comprobarBdLocal({ NEXT_PUBLIC_SUPABASE_URL: PROD, RLS_ALLOW_REMOTE: v })
      ).toThrow('solo corre contra BD local')
    }
  })
})
