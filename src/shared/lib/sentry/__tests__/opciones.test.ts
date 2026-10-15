import * as Sentry from '@sentry/nextjs'
import { afterAll, describe, expect, it } from 'vitest'

import {
  dsnDeLaUE,
  filtrarIntegraciones,
  INTEGRACIONES_CLIENTE_PERMITIDAS,
  opcionesSentry,
  RECOGIDA_DE_DATOS_APAGADA,
} from '../opciones'

const DSN_UE = 'https://clave@o123.ingest.de.sentry.io/456'
const DSN_EEUU = 'https://clave@o123.ingest.us.sentry.io/456'
const DSN_SIN_REGION = 'https://clave@o123.ingest.sentry.io/456'

describe('dsnDeLaUE — solo la región de Frankfurt', () => {
  it('acepta un DSN de la UE', () => {
    expect(dsnDeLaUE(DSN_UE)).toBe(DSN_UE)
  })

  it.each([
    ['EEUU', DSN_EEUU],
    ['sin región (EEUU por defecto)', DSN_SIN_REGION],
    ['un host que solo lo parece', 'https://clave@o1.ingest.de.sentry.io.atacante.test/1'],
    ['basura', 'no-es-una-url'],
    ['vacío', ''],
    ['ausente', undefined],
  ])('rechaza %s', (_caso, dsn) => {
    expect(dsnDeLaUE(dsn)).toBeUndefined()
  })

  it('con un DSN de fuera de la UE, Sentry queda APAGADO (no manda nada)', () => {
    const o = opcionesSentry('servidor', { dsn: DSN_EEUU })
    expect(o.dsn).toBeUndefined()
    expect(o.enabled).toBe(false)
    expect(opcionesSentry('servidor', { dsn: DSN_UE }).enabled).toBe(true)
  })
})

describe('opcionesSentry — qué se recoge', () => {
  it.each(['cliente', 'servidor', 'edge'] as const)(
    '%s: recogida de datos apagada entera y sin trazas',
    (runtime) => {
      const o = opcionesSentry(runtime, { dsn: DSN_UE })
      expect(o.dataCollection).toEqual(RECOGIDA_DE_DATOS_APAGADA)
      // `tracesSampleRate: 0` ENCENDERÍA las trazas (con muestreo 0): no tiene que estar.
      expect(o).not.toHaveProperty('tracesSampleRate')
      expect(o).not.toHaveProperty('tracesSampler')
      expect(o.beforeSendLog?.({} as never)).toBeNull()
      expect(o.beforeSendMetric?.({} as never)).toBeNull()
    }
  )

  it('la recogida apagada cubre TODAS las claves que el SDK sabe recoger', () => {
    // Si una versión nueva añade una categoría, este test obliga a decidir sobre ella.
    expect(Object.keys(RECOGIDA_DE_DATOS_APAGADA).sort()).toEqual(
      [
        'cookies',
        'databaseQueryData',
        'frameContextLines',
        'genAI',
        'graphQL',
        'httpBodies',
        'httpHeaders',
        'queues',
        'stackFrameVariables',
        'urlQueryParams',
        'userInfo',
      ].sort()
    )
    for (const [clave, valor] of Object.entries(RECOGIDA_DE_DATOS_APAGADA)) {
      const plano = JSON.stringify(valor)
      expect(plano, clave).not.toContain('true')
    }
  })

  it('cliente: grabación de sesiones a 0', () => {
    const o = opcionesSentry('cliente', { dsn: DSN_UE }) as Record<string, unknown>
    expect(o.replaysSessionSampleRate).toBe(0)
    expect(o.replaysOnErrorSampleRate).toBe(0)
  })
})

describe('filtrarIntegraciones', () => {
  const nombres = (runtime: 'cliente' | 'servidor', lista: string[]) =>
    filtrarIntegraciones(
      runtime,
      lista.map((name) => ({ name }))
    ).map((i) => i.name)

  it('cliente: solo pasan las permitidas; Replay, Feedback, trazas, sesiones y consola, fuera', () => {
    const recibidas = [
      ...INTEGRACIONES_CLIENTE_PERMITIDAS,
      'Replay',
      'ReplayCanvas',
      'Feedback',
      'BrowserTracing',
      'BrowserSession',
      'Console',
      'UnaIntegracionNuevaDelFuturo',
    ]
    expect(nombres('cliente', recibidas).sort()).toEqual(
      [...INTEGRACIONES_CLIENTE_PERMITIDAS].sort()
    )
  })

  it('servidor: fuera las variables locales y la consola; el resto se queda', () => {
    expect(
      nombres('servidor', [
        'Http',
        'LocalVariablesAsync',
        'LocalVariables',
        'Console',
        'OnUncaughtException',
      ])
    ).toEqual(['Http', 'OnUncaughtException'])
  })
})

describe('de punta a punta con el SDK real: lo que de verdad se enviaría', () => {
  const enviados: string[] = []

  afterAll(async () => {
    await Sentry.close()
  })

  it('un error con datos personales sale limpio, sin usuario ni IP', async () => {
    Sentry.init({
      ...opcionesSentry('servidor', { dsn: DSN_UE, entorno: 'test' }),
      transport: () => ({
        send: async (envelope) => {
          enviados.push(JSON.stringify(envelope))
          return {}
        },
        flush: async () => true,
      }),
    })
    // Premisa: el SDK está activo con NUESTRAS opciones.
    expect(Sentry.getClient()?.getOptions().dataCollection).toEqual(RECOGIDA_DE_DATOS_APAGADA)

    Sentry.setUser({ id: 'u-1', email: 'tutor.demo@correo.test', ip_address: '203.0.113.7' })
    Sentry.setExtra('ficha', { nombre_completo: 'Niña Demo Apellido', alergias: 'frutos secos' })
    Sentry.addBreadcrumb({ category: 'console', message: 'Niña Demo Apellido llega con fiebre' })
    Sentry.captureException(
      new Error('No se pudo guardar a lucia.demo@correo.test (DNI 12345678Z)')
    )
    await Sentry.flush(2000)

    const todo = enviados.join('\n')
    // Control: el evento se envió y lleva el error.
    expect(todo).toContain('No se pudo guardar a [email] (DNI [dni])')
    for (const dato of [
      'tutor.demo@correo.test',
      'lucia.demo@correo.test',
      '12345678Z',
      '203.0.113.7',
      'Niña Demo Apellido',
      'frutos secos',
      '"email"',
    ]) {
      expect(todo, `se ha colado ${dato}`).not.toContain(dato)
    }
    expect(todo).not.toMatch(/"user":/)
  })
})
