import type { ErrorEvent } from '@sentry/nextjs'
import { describe, expect, it } from 'vitest'

import {
  claveSensible,
  limpiarEvento,
  limpiarMiga,
  limpiarTexto,
  limpiarUrl,
} from '../limpiar-evento'

/**
 * Lo que este test defiende: ningún dato personal sale hacia Sentry. Por eso mira el evento
 * SERIALIZADO entero, no campos sueltos: un dato personal que se cuele por un campo que el
 * test no nombra tiene que ponerlo rojo igual.
 */

const DATOS_PERSONALES = {
  email: 'lucia.demo@correo.test',
  emailTutor: 'tutor.demo@correo.test',
  dni: '12345678Z',
  nie: 'X1234567L',
  telefono: '612 345 678',
  iban: 'ES91 2100 0418 4502 0005 1332',
  uuidNino: '3f2b9c1e-8a4d-4f6b-9c2e-1a2b3c4d5e6f',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.c2lnbmF0dXJh',
  nombre: 'Niña Demo Apellido',
  alergia: 'Alergia grave a frutos secos',
  observacion: 'Viene con fiebre desde casa',
  cookie: 'sb-access-token=secreto-de-sesion',
  ip: '203.0.113.7',
  variableLocal: 'valor-de-variable-local-privado',
}

function eventoConDatos(): ErrorEvent {
  const d = DATOS_PERSONALES
  return {
    type: undefined,
    event_id: 'evento-de-prueba',
    message: `No se pudo guardar la ficha de ${d.email} (DNI ${d.dni}, tel. ${d.telefono})`,
    transaction: `GET /es/family/nino/${d.uuidNino}`,
    user: { id: d.uuidNino, email: d.email, ip_address: d.ip, username: d.nombre },
    server_name: 'servidor-de-prueba',
    request: {
      method: 'POST',
      url: `https://nido.test/es/family/nino/${d.uuidNino}?email=${d.email}`,
      query_string: `email=${d.email}`,
      cookies: { 'sb-access-token': d.cookie },
      headers: { authorization: `Bearer ${d.jwt}`, cookie: d.cookie, 'x-forwarded-for': d.ip },
      data: { nombre: d.nombre, alergias: d.alergia },
    },
    exception: {
      values: [
        {
          type: 'PostgrestError',
          value: `duplicate key value violates unique constraint: Key (email)=(${d.emailTutor}) already exists; iban ${d.iban}; nie ${d.nie}`,
          stacktrace: {
            frames: [
              {
                function: 'guardarFicha',
                filename: 'src/features/ninos/actions/guardar-ficha.ts',
                vars: { email: d.email, nota: d.variableLocal },
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      { category: 'console', message: `ficha de ${d.nombre}: ${d.observacion}` },
      { category: 'ui.click', message: `button[title="Borrar a ${d.nombre}"]` },
      { category: 'ui.input', message: `input[name="dni"] ${d.dni}` },
      {
        category: 'fetch',
        data: {
          url: `https://proyecto.supabase.co/rest/v1/ninos?id=eq.${d.uuidNino}&email=eq.${d.email}`,
          method: 'GET',
          status_code: 500,
        },
      },
      {
        category: 'navigation',
        data: { from: `/es/family/nino/${d.uuidNino}`, to: `/es/admin?dni=${d.dni}` },
      },
    ],
    extra: {
      contexto: [`fallo al guardar ${d.email}`, { nombre_completo: d.nombre, alergias: d.alergia }],
      fechaNacimiento: '2024-03-01',
      anidado: { profundo: { telefono: d.telefono, observaciones: d.observacion } },
    },
    contexts: {
      browser: { name: 'Chrome', version: '130' },
      datos: { email: d.email, token: d.jwt },
    },
    tags: { correo: d.email, ruta: `/es/family/nino/${d.uuidNino}` },
  }
}

describe('limpiarEvento — ningún dato personal sale hacia Sentry', () => {
  it('premisa: el evento de entrada lleva TODOS los datos personales', () => {
    const entrada = JSON.stringify(eventoConDatos())
    for (const [campo, valor] of Object.entries(DATOS_PERSONALES)) {
      expect(entrada, `la entrada debería llevar ${campo}`).toContain(valor)
    }
  })

  it('el evento limpio no contiene ninguno', () => {
    const salida = JSON.stringify(limpiarEvento(eventoConDatos()))
    for (const [campo, valor] of Object.entries(DATOS_PERSONALES)) {
      expect(salida, `se ha colado ${campo}`).not.toContain(valor)
    }
    // Tampoco por partes: el teléfono sin espacios, el IBAN compacto, el uuid en mayúsculas.
    expect(salida).not.toContain('612345678')
    expect(salida).not.toContain('ES9121000418')
    expect(salida.toLowerCase()).not.toContain(DATOS_PERSONALES.uuidNino)
  })

  it('control: lo técnico que hace falta para entender el fallo se conserva', () => {
    const e = limpiarEvento(eventoConDatos())
    expect(e.exception?.values?.[0]?.type).toBe('PostgrestError')
    expect(e.exception?.values?.[0]?.value).toContain('duplicate key value violates unique')
    expect(e.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
      function: 'guardarFicha',
      filename: 'src/features/ninos/actions/guardar-ficha.ts',
    })
    expect(e.request).toEqual({ method: 'POST', url: 'https://nido.test/es/family/nino/[id]' })
    expect(e.transaction).toBe('GET /es/family/nino/[id]')
    expect(e.contexts?.browser).toEqual({ name: 'Chrome', version: '130' })
    expect(e.breadcrumbs?.map((b) => b.category)).toEqual(['fetch', 'navigation'])
    expect(e.breadcrumbs?.[0]?.data).toEqual({
      url: 'https://proyecto.supabase.co/rest/v1/ninos',
      method: 'GET',
      status_code: 500,
    })
  })

  it('quita el usuario y el nombre del servidor, y no muta el evento original', () => {
    const original = eventoConDatos()
    const e = limpiarEvento(original)
    expect(e.user).toBeUndefined()
    expect(e.server_name).toBeUndefined()
    expect(original.user?.email).toBe(DATOS_PERSONALES.email)
  })
})

describe('piezas del limpiador', () => {
  it.each([
    ['email', 'escribe a ana@demo.test ya', 'escribe a [email] ya'],
    ['DNI con letra', 'DNI 12345678-Z', 'DNI [dni]'],
    ['NIE', 'NIE Y 1234567 X', 'NIE [dni]'],
    ['móvil con prefijo', '+34 612-345-678', '[telefono]'],
    ['fijo', 'llamar al 961234567', 'llamar al [telefono]'],
    ['IBAN', 'cuenta ES9121000418450200051332', 'cuenta [iban]'],
    ['uuid', 'id 3F2B9C1E-8A4D-4F6B-9C2E-1A2B3C4D5E6F', 'id [id]'],
    ['bearer', 'Authorization: Bearer abc.def-123', 'Authorization: Bearer [token]'],
    [
      'query de URL',
      'GET https://x.test/a?email=ana@demo.test&b=1 falló',
      'GET https://x.test/a?[query] falló',
    ],
  ])('limpiarTexto tacha %s', (_caso, entrada, salida) => {
    expect(limpiarTexto(entrada)).toBe(salida)
  })

  it('control: un texto sin datos personales no cambia', () => {
    const texto = 'TypeError: Cannot read properties of undefined (reading "map") en la línea 42'
    expect(limpiarTexto(texto)).toBe(texto)
  })

  it.each([
    ['email', true],
    ['emailTutor', true],
    ['nombre_completo', true],
    ['fechaNacimiento', true],
    ['first_name', true],
    ['ip_address', true],
    ['x-forwarded-for', false],
    ['tipo', false],
    ['status_code', false],
    ['name', false],
    ['version', false],
  ])('claveSensible(%s) = %s', (clave, esperado) => {
    expect(claveSensible(clave)).toBe(esperado)
  })

  it('limpiarUrl deja origen y ruta, sin query ni fragmento', () => {
    expect(limpiarUrl('https://nido.test/es/x?dni=12345678Z#frag')).toBe('https://nido.test/es/x')
    expect(limpiarUrl('/es/family/nino/3f2b9c1e-8a4d-4f6b-9c2e-1a2b3c4d5e6f?a=1')).toBe(
      '/es/family/nino/[id]'
    )
  })

  it('las migas de consola y de interfaz no se envían', () => {
    expect(limpiarMiga({ category: 'console', message: 'x' })).toBeNull()
    expect(limpiarMiga({ category: 'ui.click', message: 'x' })).toBeNull()
    expect(limpiarMiga({ category: 'navigation', data: { to: '/es/a?x=1' } })?.data).toEqual({
      to: '/es/a',
    })
  })
})
