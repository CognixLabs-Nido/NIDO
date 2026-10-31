import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PR-0a de la serie de altas (`docs/specs/altas-serie.md`, D10) — el mandato SEPA no es
 * obligatorio para cerrar el alta. «Omitir por ahora» llama a `finalizarAlta`, y hasta este PR el
 * gate respondía «falta: Mandato SEPA», así que la familia que paga en efectivo no podía cerrarla.
 *
 * El cliente falso contesta por tabla con filas de la forma real (columnas de producción, el
 * `rol_familia` de `familia_tutores`), y `leerTutoresDeNino` corre de verdad sobre él. Una tabla
 * que el falso no conoce lanza: una consulta nueva del gate no pasa en silencio.
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
  acuses_alta: Fila[]
  familia_tutores: Fila[]
  consentimientos: Fila[]
  mandatos_sepa: Fila[]
  autorizaciones: Fila[]
  firmas_autorizacion: Fila[]
  imagenConsentida: boolean
}

function altaCompleta(): Estado {
  return {
    ninos: [
      {
        apellidos: 'Demo Pruebas',
        fecha_nacimiento: '2025-03-01',
        libro_familia_path: `${CENTRO}/${NINO}/libro-familia.pdf`,
        familia_id: FAMILIA,
        centro_id: CENTRO,
      },
    ],
    acuses_alta: [{ tipo: 'normas' }],
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
    // Como en producción: sin instancia de normas publicada; las normas van por la casilla.
    autorizaciones: [],
    firmas_autorizacion: [],
    imagenConsentida: true,
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
      if (!(tabla in estado) || tabla === 'imagenConsentida')
        throw new Error(`tabla no prevista en el falso: ${tabla}`)
      tablasLeidas.push(tabla)
      return builder(tabla as keyof Estado)
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcSpy(fn, args)
      if (fn === 'existe_consentimiento_imagen')
        return Promise.resolve({ data: estado.imagenConsentida, error: null })
      if (fn === 'marcar_matricula_lista') return Promise.resolve({ data: NINO, error: null })
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
