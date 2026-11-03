import { beforeEach, describe, expect, it, vi } from 'vitest'

import { leerAvisoReabrir } from '../leer-aviso-reabrir'

/**
 * El aviso de reabrir: los números salen de `resumen_reabrir_remesa` (la misma consulta que
 * comprueba la función), y quiénes son los devueltos y cobrados se lee con la sesión. Tienen que
 * salir tantos como cuenta el resumen: si no, no hay aviso, porque la admin confirmaría sin ver a
 * una familia que ya pagó o ya fue al banco.
 */

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from }) }))

const ID = '11111111-1111-4111-8111-111111111111'

/** El resumen como lo devuelve la BD (claves de `privado.resumen_reabrir_remesa`). */
function resumen(cambios: Record<string, unknown> = {}) {
  return {
    estado: 'enviada',
    fecha_envio_banco: '2026-10-20',
    fichero_generado_at: '2026-10-19T09:00:00+00:00',
    fichero_guardado: true,
    n_recibos: 2,
    n_familias: 2,
    total_centimos: 20000,
    n_enviados: 2,
    n_devueltos: 0,
    n_cobrados: 0,
    ...cambios,
  }
}

type Respuesta = { data: unknown; error: { code: string; message: string } | null }

/** Los filtros que pidió cada lectura, para afirmar qué se pidió y no solo qué volvió. */
const filtros: Array<[string, string, unknown[]]> = []

/** `from(tabla)` con una respuesta por tabla; la cadena apunta sus filtros en `filtros`. */
function tablas(por: Record<string, Respuesta>) {
  from.mockImplementation((tabla: string) => {
    const r = por[tabla]
    if (!r) throw new Error(`lectura inesperada de ${tabla}`)
    const cadena: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in'])
      cadena[m] = (...args: unknown[]) => {
        filtros.push([tabla, m, args])
        return cadena
      }
    cadena.then = (ok: (v: Respuesta) => unknown) => Promise.resolve(r).then(ok)
    return cadena
  })
}

const CON_HISTORIA = {
  recibos_remesa: {
    data: [{ recibo_id: 'r1' }, { recibo_id: 'r2' }, { recibo_id: 'r3' }],
    error: null,
  },
  recibos: {
    data: [
      { id: 'r2', familia_id: 'fB', total_centimos: 7000, estado: 'cobrado_manual' },
      { id: 'r3', familia_id: 'fA', total_centimos: 5000, estado: 'devuelto' },
    ],
    error: null,
  },
  familias: {
    data: [
      { id: 'fA', etiqueta: 'Familia Demo Alba' },
      { id: 'fB', etiqueta: 'Familia Demo Beta' },
    ],
    error: null,
  },
}

describe('leerAvisoReabrir', () => {
  beforeEach(() => {
    filtros.length = 0
    rpc.mockReset().mockResolvedValue({ data: resumen(), error: null })
    from.mockReset().mockImplementation((t: string) => {
      throw new Error(`lectura inesperada de ${t}`)
    })
  })

  it('sin devueltos ni cobrados, el resumen basta: no lee ninguna tabla', async () => {
    const r = await leerAvisoReabrir({ remesaId: ID })
    expect(r).toEqual({
      success: true,
      data: { remesaId: ID, resumen: resumen(), caso: 'enviada', noSeTocan: [] },
    })
    expect(rpc).toHaveBeenCalledWith('resumen_reabrir_remesa', { p_remesa_id: ID })
    expect(from).not.toHaveBeenCalled()
  })

  it.each([
    [{ estado: 'enviada', fichero_guardado: true }, 'enviada'],
    // Descargada antes de R-1: marca sin fichero guardado. NIDO sabe que se descargó.
    [{ estado: 'enviada', fichero_guardado: false }, 'enviada'],
    [
      { estado: 'enviada', fichero_generado_at: null, fichero_guardado: false },
      'enviada_sin_constancia',
    ],
    [{ estado: 'borrador', fecha_envio_banco: null }, 'fichero_descargado'],
  ])('el caso del aviso con %o es %s', async (cambios, caso) => {
    rpc.mockResolvedValue({ data: resumen(cambios), error: null })
    const r = await leerAvisoReabrir({ remesaId: ID })
    expect(r.success && r.data.caso).toBe(caso)
  })

  it('nombra a los devueltos y cobrados, con su importe y su estado, por familia', async () => {
    rpc.mockResolvedValue({ data: resumen({ n_devueltos: 1, n_cobrados: 1 }), error: null })
    tablas(CON_HISTORIA)
    const r = await leerAvisoReabrir({ remesaId: ID })
    expect(r.success && r.data.noSeTocan).toEqual([
      { id: 'r3', familiaEtiqueta: 'Familia Demo Alba', totalCentimos: 5000, estado: 'devuelto' },
      {
        id: 'r2',
        familiaEtiqueta: 'Familia Demo Beta',
        totalCentimos: 7000,
        estado: 'cobrado_manual',
      },
    ])
    // Lo que se pidió: los enlaces de ESTA remesa, y de sus recibos solo los dos estados.
    expect(filtros).toContainEqual(['recibos_remesa', 'eq', ['remesa_id', ID]])
    expect(filtros).toContainEqual(['recibos', 'in', ['id', ['r1', 'r2', 'r3']]])
    expect(filtros).toContainEqual(['recibos', 'in', ['estado', ['devuelto', 'cobrado_manual']]])
  })

  it('si los leídos no son tantos como cuenta el resumen, no hay aviso', async () => {
    // Premisa: con los mismos datos y el recuento que les toca, el aviso sale.
    rpc.mockResolvedValue({ data: resumen({ n_devueltos: 1, n_cobrados: 1 }), error: null })
    tablas(CON_HISTORIA)
    expect((await leerAvisoReabrir({ remesaId: ID })).success).toBe(true)

    for (const cuenta of [
      { n_devueltos: 2, n_cobrados: 1 },
      { n_devueltos: 1, n_cobrados: 0 },
    ]) {
      rpc.mockResolvedValue({ data: resumen(cuenta), error: null })
      expect.soft(await leerAvisoReabrir({ remesaId: ID }), JSON.stringify(cuenta)).toEqual({
        success: false,
        error: 'remesas.errors.aviso_incompleto',
      })
    }
  })

  it.each(['recibos_remesa', 'recibos', 'familias'])(
    'si falla la lectura de %s, no hay aviso',
    async (tabla) => {
      rpc.mockResolvedValue({ data: resumen({ n_devueltos: 1, n_cobrados: 1 }), error: null })
      tablas({ ...CON_HISTORIA, [tabla]: { data: null, error: { code: 'XX000', message: 'x' } } })
      expect(await leerAvisoReabrir({ remesaId: ID })).toEqual({
        success: false,
        error: 'remesas.errors.aviso_failed',
      })
    }
  )

  it.each([[{ n_familias: undefined }], [{ total_centimos: '20000' }], [{ estado: 'cerrada' }]])(
    'un resumen con otra forma (%o) no se pinta: no hay aviso',
    async (cambios) => {
      rpc.mockResolvedValue({ data: resumen(cambios), error: null })
      expect(await leerAvisoReabrir({ remesaId: ID })).toEqual({
        success: false,
        error: 'remesas.errors.aviso_failed',
      })
    }
  )

  it.each([
    [{ code: '42501', hint: null }, 'remesas.errors.no_autorizado'],
    [{ code: 'P0001', hint: 'no_encontrada' }, 'remesas.errors.no_encontrada'],
    [{ code: 'XX000', hint: null }, 'remesas.errors.aviso_failed'],
  ])('el rechazo del resumen %o se dice como %s', async (error, clave) => {
    rpc.mockResolvedValue({ data: null, error: { ...error, message: 'x' } })
    expect(await leerAvisoReabrir({ remesaId: ID })).toEqual({ success: false, error: clave })
  })

  it('con un id que no es un uuid, no llama a la BD', async () => {
    expect(await leerAvisoReabrir({ remesaId: 'x' })).toEqual({
      success: false,
      error: 'remesas.errors.invalid',
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})
