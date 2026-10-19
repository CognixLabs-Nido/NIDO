import { describe, expect, it } from 'vitest'

import { centroDelAvisoPorConfirmar, urlDelAviso } from '../centro-del-aviso'
import type { CentroDelUsuario } from '../resolver'

/**
 * Centro de una notificación push (multicentro): cuándo se pide confirmar el cambio de centro y
 * cómo lleva el enlace su centro.
 */

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const AJENO = '00000000-0000-4000-8000-0000000000ff'

const centro = (centroId: string): CentroDelUsuario => ({
  centroId,
  rol: 'tutor_legal',
  roles: ['tutor_legal'],
})
const dosCentros = { centroId: A, centros: [centro(A), centro(B)] }
const unCentro = { centroId: A, centros: [centro(A)] }

describe('centroDelAvisoPorConfirmar', () => {
  it('otro centro del usuario → ese centro (se pide confirmar)', () => {
    expect(centroDelAvisoPorConfirmar(dosCentros, B)).toBe(B)
  })

  it('el centro activo → null (se abre como siempre)', () => {
    expect(centroDelAvisoPorConfirmar(dosCentros, A)).toBeNull()
  })

  it('con un solo centro, el suyo → null', () => {
    expect(centroDelAvisoPorConfirmar(unCentro, A)).toBeNull()
  })

  it('un centro que no es del usuario → null (la página hace lo de siempre)', () => {
    expect(centroDelAvisoPorConfirmar(dosCentros, AJENO)).toBeNull()
    expect(centroDelAvisoPorConfirmar(unCentro, B)).toBeNull()
  })

  it('sin centro en el enlace, o repetido → null', () => {
    expect(centroDelAvisoPorConfirmar(dosCentros, undefined)).toBeNull()
    expect(centroDelAvisoPorConfirmar(dosCentros, [B, B])).toBeNull()
    expect(centroDelAvisoPorConfirmar(dosCentros, '')).toBeNull()
  })
})

describe('urlDelAviso', () => {
  it('añade el centro a una ruta sin query', () => {
    expect(urlDelAviso('/es/messages/anuncios/x', B)).toBe(`/es/messages/anuncios/x?centro=${B}`)
  })

  it('y a una con query, sin perder lo que llevaba', () => {
    expect(urlDelAviso('/va/messages?nino=n1', B)).toBe(`/va/messages?nino=n1&centro=${B}`)
  })
})
