import { createHash } from 'crypto'

import { describe, expect, it } from 'vitest'

import { hashTextoAutorizacion, normalizarTexto } from '../hash'

describe('hashTextoAutorizacion', () => {
  it('produce un SHA-256 hex de 64 chars (cumple el CHECK de BD)', () => {
    const h = hashTextoAutorizacion('Autorizo la salida de mi hijo.')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('es estable: el mismo texto da el mismo hash', () => {
    const t = 'Texto legal de la autorización de salida.'
    expect(hashTextoAutorizacion(t)).toBe(hashTextoAutorizacion(t))
  })

  it('es verificable contra crypto estándar tras normalizar', () => {
    const t = 'Autorizo.\r\nFirmado.'
    const esperado = createHash('sha256').update(normalizarTexto(t), 'utf8').digest('hex')
    expect(hashTextoAutorizacion(t)).toBe(esperado)
  })

  it('un cambio material del texto cambia el hash (prueba de integridad)', () => {
    expect(hashTextoAutorizacion('Autorizo A')).not.toBe(hashTextoAutorizacion('Autorizo B'))
  })

  it('normaliza CRLF/CR a LF para que el hash no dependa del cliente', () => {
    expect(hashTextoAutorizacion('a\r\nb')).toBe(hashTextoAutorizacion('a\nb'))
    expect(hashTextoAutorizacion('a\rb')).toBe(hashTextoAutorizacion('a\nb'))
  })

  it('recorta espacios al final de línea pero conserva el contenido', () => {
    expect(normalizarTexto('hola  \nadios\t')).toBe('hola\nadios')
  })
})
