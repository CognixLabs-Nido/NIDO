import { createHash } from 'crypto'

import { describe, expect, it } from 'vitest'

import { canonicalJSON, hashFirma, hashTextoAutorizacion, normalizarTexto } from '../hash'

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

describe('canonicalJSON — estable bit a bit', () => {
  it('ordena las claves de los objetos (independiente del orden de inserción)', () => {
    expect(canonicalJSON({ b: 1, a: 2 })).toBe(canonicalJSON({ a: 2, b: 1 }))
    expect(canonicalJSON({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('ordena claves recursivamente', () => {
    const x = { z: { d: 1, c: 2 }, a: 3 }
    const y = { a: 3, z: { c: 2, d: 1 } }
    expect(canonicalJSON(x)).toBe(canonicalJSON(y))
  })

  it('conserva el orden de los arrays (el orden de la lista es significativo)', () => {
    expect(canonicalJSON([1, 2])).not.toBe(canonicalJSON([2, 1]))
  })
})

describe('hashFirma — hash compuesto + compatibilidad', () => {
  const texto = 'Autorizo la recogida de mi hijo.'

  it('SIN datos = sha256(texto) EXACTO (compat F8-1/F8-2b)', () => {
    const esperado = createHash('sha256').update(normalizarTexto(texto), 'utf8').digest('hex')
    expect(hashFirma(texto)).toBe(esperado)
    expect(hashTextoAutorizacion(texto)).toBe(esperado)
    expect(hashFirma(texto)).toBe(hashTextoAutorizacion(texto))
  })

  it('datos vacío {} se trata como SIN datos (mismo hash que el texto solo)', () => {
    expect(hashFirma(texto, {})).toBe(hashTextoAutorizacion(texto))
  })

  it('con lista cambia el hash respecto al texto solo', () => {
    const datos = { personas: [{ nombre: 'Ana', dni: '12345678Z' }] }
    expect(hashFirma(texto, datos)).not.toBe(hashTextoAutorizacion(texto))
  })

  it('es estable e independiente del orden de claves en los datos', () => {
    const a = { personas: [{ nombre: 'Ana', dni: '12345678Z' }] }
    const b = { personas: [{ dni: '12345678Z', nombre: 'Ana' }] }
    expect(hashFirma(texto, a)).toBe(hashFirma(texto, b))
  })

  it('un cambio en la lista (añadir persona) cambia el hash (integridad)', () => {
    const a = { personas: [{ nombre: 'Ana', dni: '1' }] }
    const b = {
      personas: [
        { nombre: 'Ana', dni: '1' },
        { nombre: 'Leo', dni: '2' },
      ],
    }
    expect(hashFirma(texto, a)).not.toBe(hashFirma(texto, b))
  })

  it('el orden de las personas en la lista importa (no se ordena el array)', () => {
    const a = { personas: [{ dni: '1' }, { dni: '2' }] }
    const b = { personas: [{ dni: '2' }, { dni: '1' }] }
    expect(hashFirma(texto, a)).not.toBe(hashFirma(texto, b))
  })

  it('verificable contra crypto estándar con el separador 0x01', () => {
    const datos = { personas: [{ dni: '1', nombre: 'Ana' }] }
    const payload = normalizarTexto(texto) + String.fromCharCode(1) + canonicalJSON(datos)
    const esperado = createHash('sha256').update(payload, 'utf8').digest('hex')
    expect(hashFirma(texto, datos)).toBe(esperado)
  })
})
