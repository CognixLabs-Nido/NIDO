import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PR-0a de la serie de altas (`docs/specs/altas-serie.md`, D10) — el mandato SEPA no es
 * obligatorio para cerrar el alta. «Omitir por ahora» llama a `finalizarAlta`, y hasta este PR el
 * gate respondía «falta: Mandato SEPA», así que la familia que paga en efectivo no podía cerrarla.
 *
 * El cliente falso contesta por tabla con filas de la forma real (columnas de producción, el
 * `rol_familia` de `familia_tutores`), y `leerTutoresDeNino` corre de verdad sobre él. Una tabla
 * que el falso no conoce lanza: una consulta nueva del gate no pasa en silencio. Desde el 4b-2 no
 * conoce `acuses_alta`, `autorizaciones` ni `firmas_autorizacion`: si el gate volviera a leer la
 * casilla o la autorización de normas, lanzaría.
 */

const USER = '11111111-1111-4111-8111-111111111111'
const NINO = '22222222-2222-4222-8222-222222222222'
const FAMILIA = '33333333-3333-4333-8333-333333333333'
const CENTRO = '44444444-4444-4444-8444-444444444444'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClientMock() }))

import { finalizarAlta } from '../finalizar-alta'

type Fila = Record<string, unknown>

interface Estado {
  ninos: Fila[]
  familia_tutores: Fila[]
  consentimientos: Fila[]
  mandatos_sepa: Fila[]
  imagenConsentida: boolean
  /** Lo que devuelve `documentos_firma_nino`; `null` = la lectura falla. */
  documentosCentro: Fila[] | null
  /** El error de `marcar_matricula_lista`, si lo da. */
  errorMarcar?: { code: string; message: string; hint: string | null }
}

/** Una fila de `documentos_firma_nino`, con las columnas de la función (4a). */
const doc = (titulo: string, obligatorio: boolean, estado: string): Fila => ({
  documento_id: '88888888-8888-4888-8888-888888888888',
  titulo,
  de_curso: false,
  obligatorio,
  orden: 1,
  curso_academico_id: null,
  curso_nombre: null,
  estado,
  version_id: estado === 'falta_documento' ? null : '99999999-9999-4999-8999-999999999999',
  numero: estado === 'falta_documento' ? null : 1,
  disponible_desde: null,
  firma_id: estado === 'firmado' ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : null,
  firmado_at: estado === 'firmado' ? '2026-11-06T10:00:00Z' : null,
  metodo_firma: estado === 'firmado' ? 'digital' : null,
})

function altaCompleta(): Estado {
  return {
    ninos: [
      {
        apellidos: 'Demo Pruebas',
        fecha_nacimiento: '2025-03-01',
        // Fase 5b: los tres obligatorios.
        lugar_nacimiento: 'Valencia',
        nacionalidad: 'española',
        hermanos_total: 1,
        libro_familia_path: `${CENTRO}/${NINO}/libro-familia.pdf`,
        familia_id: FAMILIA,
        centro_id: CENTRO,
      },
    ],
    familia_tutores: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        rol_familia: 'titular',
        usuario_id: USER,
        email: 'tutor.demo@example.test',
        nombre_completo: 'Tutor Demo',
        direccion_calle: null,
        direccion_numero: null,
        direccion_cp: null,
        direccion_ciudad: null,
        dni_documento_path: `${CENTRO}/${NINO}/dni-titular.pdf`,
      },
    ],
    consentimientos: [{ id: '66666666-6666-4666-8666-666666666666' }],
    mandatos_sepa: [],
    imagenConsentida: true,
    // Las normas, firmadas: el alta completa.
    documentosCentro: [doc('Normas', true, 'firmado')],
  }
}

function makeFake(estado: Estado) {
  const tablasLeidas: string[] = []
  const rpcSpy = vi.fn()

  function builder(tabla: keyof Estado) {
    const filas = estado[tabla] as Fila[]
    const b = {
      select: () => b,
      eq: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve({ data: filas[0] ?? null, error: null }),
      then: (resolve: (v: { data: Fila[]; error: null }) => unknown) =>
        resolve({ data: filas, error: null }),
    }
    return b
  }

  const fake = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: USER } } }) },
    from: (tabla: string) => {
      if (
        !(tabla in estado) ||
        ['imagenConsentida', 'documentosCentro', 'errorMarcar'].includes(tabla)
      )
        throw new Error(`tabla no prevista en el falso: ${tabla}`)
      tablasLeidas.push(tabla)
      return builder(tabla as keyof Estado)
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcSpy(fn, args)
      // Los hermanos y el libro de familia son de gestión: salen por su función desde
      // `20270115120000`. El falso los saca de la misma fila del niño del estado.
      if (fn === 'ficha_gestion_ninos') {
        const n = estado.ninos[0]
        return Promise.resolve({
          data: n
            ? [
                {
                  nino_id: NINO,
                  hermanos_total: n.hermanos_total ?? null,
                  libro_familia_path: n.libro_familia_path ?? null,
                },
              ]
            : [],
          error: null,
        })
      }
      if (fn === 'existe_consentimiento_imagen')
        return Promise.resolve({ data: estado.imagenConsentida, error: null })
      if (fn === 'documentos_firma_nino')
        return Promise.resolve(
          estado.documentosCentro
            ? { data: estado.documentosCentro, error: null }
            : { data: null, error: { code: 'XX000', message: 'fallo' } }
        )
      if (fn === 'marcar_matricula_lista')
        return Promise.resolve(
          estado.errorMarcar
            ? { data: null, error: estado.errorMarcar }
            : { data: NINO, error: null }
        )
      throw new Error(`rpc no prevista en el falso: ${fn}`)
    },
  }
  return { fake, rpcSpy, tablasLeidas }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('finalizarAlta · el mandato SEPA no es obligatorio (D10)', () => {
  it('premisa: el falso hace caer un bloque que falta (sin libro de familia → documentos)', async () => {
    // Con mandato: la premisa no depende del arreglo que vigilan los tests de abajo.
    const estado = altaCompleta()
    estado.mandatos_sepa = [{ id: '77777777-7777-4777-8777-777777777777' }]
    estado.ninos[0].libro_familia_path = null
    const { fake, rpcSpy } = makeFake(estado)
    createClientMock.mockReturnValue(fake)

    const r = await finalizarAlta(NINO)

    expect(r).toEqual({ success: false, error: 'alta.errors.incompleto', faltan: ['documentos'] })
    expect(rpcSpy).not.toHaveBeenCalledWith('marcar_matricula_lista', expect.anything())
  })

  it('premisa: con el alta completa y mandato, finaliza', async () => {
    const estado = altaCompleta()
    estado.mandatos_sepa = [{ id: '77777777-7777-4777-8777-777777777777' }]
    const { fake, rpcSpy } = makeFake(estado)
    createClientMock.mockReturnValue(fake)

    const r = await finalizarAlta(NINO)

    expect(r).toEqual({ success: true, data: { id: NINO } })
    expect(rpcSpy).toHaveBeenCalledWith('marcar_matricula_lista', { p_nino_id: NINO })
  })

  it('sin mandato SEPA, el alta completa finaliza igual (lo que hace «Omitir por ahora»)', async () => {
    const { fake, rpcSpy } = makeFake(altaCompleta())
    createClientMock.mockReturnValue(fake)

    const r = await finalizarAlta(NINO)

    expect(r).toEqual({ success: true, data: { id: NINO } })
    expect(rpcSpy).toHaveBeenCalledWith('marcar_matricula_lista', { p_nino_id: NINO })
  })

  it('sin mandato y con otro bloque pendiente, lo que falta no incluye el SEPA', async () => {
    const estado = altaCompleta()
    estado.consentimientos = []
    const { fake } = makeFake(estado)
    createClientMock.mockReturnValue(fake)

    const r = await finalizarAlta(NINO)

    expect(r).toEqual({ success: false, error: 'alta.errors.incompleto', faltan: ['medico'] })
  })

  it('el gate no consulta los mandatos', async () => {
    const { fake, tablasLeidas } = makeFake(altaCompleta())
    createClientMock.mockReturnValue(fake)

    await finalizarAlta(NINO)

    expect(tablasLeidas).toContain('familia_tutores')
    expect(tablasLeidas).not.toContain('mandatos_sepa')
  })
})

async function cierra(estado: Estado) {
  const { fake, rpcSpy } = makeFake(estado)
  createClientMock.mockReturnValue(fake)
  const r = await finalizarAlta(NINO)
  return { r, cerro: rpcSpy.mock.calls.some(([fn]) => fn === 'marcar_matricula_lista') }
}

describe('finalizarAlta · los documentos del centro (fase 4, 4b-2)', () => {
  it('premisa: con las normas firmadas, finaliza', async () => {
    expect(await cierra(altaCompleta())).toEqual({
      r: { success: true, data: { id: NINO } },
      cerro: true,
    })
  })

  it('un documento obligatorio por firmar frena el alta, y no se llama a la base', async () => {
    const estado = altaCompleta()
    estado.documentosCentro = [
      doc('Normas', true, 'firmado'),
      doc('Presupuesto', true, 'por_firmar'),
    ]
    expect(await cierra(estado)).toEqual({
      r: { success: false, error: 'alta.errors.incompleto', faltan: ['documentos_centro'] },
      cerro: false,
    })
  })

  it('uno que el centro no ha subido no frena: el alta se cierra sin normas (decisión 1)', async () => {
    const estado = altaCompleta()
    estado.documentosCentro = [doc('Normas', true, 'falta_documento')]
    expect(await cierra(estado)).toEqual({
      r: { success: true, data: { id: NINO } },
      cerro: true,
    })
  })

  it('uno opcional por firmar no frena', async () => {
    const estado = altaCompleta()
    estado.documentosCentro = [doc('Normas', true, 'firmado'), doc('Salida', false, 'por_firmar')]
    expect((await cierra(estado)).r).toEqual({ success: true, data: { id: NINO } })
  })

  it('si la lectura de los documentos falla, no se cierra: una lista vacía diría «nada que firmar»', async () => {
    const estado = altaCompleta()
    estado.documentosCentro = null
    expect(await cierra(estado)).toEqual({
      r: { success: false, error: 'alta.errors.finalizar_fallo' },
      cerro: false,
    })
  })

  it('si la base frena (documentos_por_firmar), se dice lo que falta, no «no se pudo»', async () => {
    const estado = altaCompleta()
    estado.errorMarcar = {
      code: 'P0001',
      message: 'faltan documentos del centro por firmar',
      hint: 'documentos_por_firmar',
    }
    expect((await cierra(estado)).r).toEqual({
      success: false,
      error: 'alta.errors.incompleto',
      faltan: ['documentos_centro'],
    })
  })
})

describe('finalizarAlta · los datos del niño que el alta exige (fase 5b)', () => {
  it('premisa: con los cinco puestos, finaliza', async () => {
    expect((await cierra(altaCompleta())).cerro).toBe(true)
  })

  for (const [campo, vacio] of [
    ['lugar_nacimiento', null],
    ['lugar_nacimiento', '   '],
    ['nacionalidad', null],
    ['nacionalidad', ''],
    ['hermanos_total', null],
    ['apellidos', null],
    ['fecha_nacimiento', null],
  ] as const) {
    it(`sin ${campo} (${JSON.stringify(vacio)}) falta «identidad» y no se llama a la base`, async () => {
      const estado = altaCompleta()
      ;(estado.ninos![0] as Record<string, unknown>)[campo] = vacio
      expect(await cierra(estado)).toEqual({
        r: { success: false, error: 'alta.errors.incompleto', faltan: ['identidad'] },
        cerro: false,
      })
    })
  }

  it('si la base frena (datos_nino_por_completar), se dice lo que falta, no «no se pudo»', async () => {
    const estado = altaCompleta()
    estado.errorMarcar = {
      code: 'P0001',
      message: 'faltan datos del nino por completar',
      hint: 'datos_nino_por_completar',
    }
    expect((await cierra(estado)).r).toEqual({
      success: false,
      error: 'alta.errors.incompleto',
      faltan: ['identidad'],
    })
  })
})
