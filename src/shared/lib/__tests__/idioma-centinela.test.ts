import { describe, expect, it } from 'vitest'

import {
  IDIOMA_CENTINELA_PURGA,
  etiquetaIdiomaPrincipal,
  idiomasVisibles,
} from '../idioma-centinela'

describe('idioma-centinela', () => {
  it('premisa: el centinela es el mismo que escribe la purga', () => {
    expect(IDIOMA_CENTINELA_PURGA).toBe('zz')
  })

  it('idioma_principal: endónimo para es/en/va, «—» para el centinela y lo desconocido', () => {
    expect(etiquetaIdiomaPrincipal('es')).toBe('Español')
    expect(etiquetaIdiomaPrincipal('en')).toBe('English')
    expect(etiquetaIdiomaPrincipal('va')).toBe('Valencià')
    expect(etiquetaIdiomaPrincipal('zz')).toBe('—')
    expect(etiquetaIdiomaPrincipal(null)).toBe('—')
    expect(etiquetaIdiomaPrincipal('xx')).toBe('—')
  })

  it('idiomas_casa: quita el centinela y deja los demás', () => {
    expect(idiomasVisibles(['zz'])).toEqual([])
    expect(idiomasVisibles(['es', 'ar'])).toEqual(['es', 'ar'])
    expect(idiomasVisibles(null)).toEqual([])
  })
})
