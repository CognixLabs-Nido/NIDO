import { describe, expect, it } from 'vitest'

import {
  fechaNacimientoTutorValida,
  normalizarTelefono,
  telefonoValido,
  tutorCompleto,
} from '../datos-tutor'
import { documentoTutorValido } from '../documento-identidad'

/**
 * Fase 6: los datos del tutor, espejo de la base (`20270118120000`). Las validaciones no pueden dejar
 * fuera a una familia real: teléfono de otro país, documento extranjero, padre o madre menor.
 */
describe('teléfono del tutor', () => {
  it('normaliza espacios, puntos, guiones y paréntesis, y el 00 como +', () => {
    expect(normalizarTelefono('0034 (600) 11.22-33')).toBe('+34600112233')
    expect(normalizarTelefono('   ')).toBeNull()
  })
  it.each([
    ['600 11 22 33', true], // español sin prefijo
    ['+44 20 7946 0958', true], // Reino Unido
    ['00212 6 12 34 56 78', true], // Marruecos con 00
    ['+1 (415) 555-0100', true], // EE. UU.
    ['12345', false], // 5 cifras
    ['+1234567890123456', false], // 16 cifras
    ['600-ABC', false],
  ])('%s → %s', (t, ok) => expect(telefonoValido(t)).toBe(ok))
})

describe('fecha de nacimiento del tutor', () => {
  const hoy = '2026-11-13'
  it.each([
    ['1985-01-01', true],
    ['2010-06-30', true], // menor de edad: vale
    ['1906-11-13', true], // justo 120 años
    ['1906-11-12', false],
    ['1850-01-01', false],
    ['2026-11-13', false], // hoy no es pasado
    ['2027-01-01', false],
    ['13/11/1985', false],
  ])('%s → %s', (f, ok) => expect(fechaNacimientoTutorValida(f, hoy)).toBe(ok))
})

describe('documento del tutor', () => {
  it.each([
    ['12345678Z', true],
    ['12.345.678-z', true],
    ['12345678A', false], // DNI con la letra mal
    ['X1234567L', true],
    ['X1234567A', false], // NIE con la letra mal
    ['P1234567', true], // pasaporte
    ['AB 123456 C', true], // documento extranjero
    ['', false],
    ['x'.repeat(41), false],
  ])('%s → %s', (d, ok) => expect(documentoTutorValido(d)).toBe(ok))
})

describe('tutor completo (espejo de privado.tutor_completo)', () => {
  const COMPLETO = {
    nombre_completo: 'Tutor Demo',
    email: 't@correo.test',
    telefono: '+34600000000',
    fecha_nacimiento: '1985-01-01',
    dni_numero: '12345678Z',
    dni_documento_path: 'c/n/dni.pdf',
    direccion_calle: 'Calle Demo',
    direccion_cp: '46001',
    direccion_ciudad: 'Ciudad Demo',
  }
  it('completo, sin número de calle ni estudios ni empresa', () => {
    expect(tutorCompleto(COMPLETO)).toBe(true)
  })
  it.each(Object.keys(COMPLETO))('sin %s, no', (c) => {
    expect(tutorCompleto({ ...COMPLETO, [c]: null })).toBe(false)
  })
  it('un campo en blanco cuenta como vacío', () => {
    expect(tutorCompleto({ ...COMPLETO, direccion_ciudad: '  ' })).toBe(false)
  })
  it('sin PDF cuenta como completo solo si se pide sin PDF', () => {
    expect(tutorCompleto({ ...COMPLETO, dni_documento_path: null }, { conPdf: false })).toBe(true)
  })
})
