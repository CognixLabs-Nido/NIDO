import { beforeEach, describe, expect, it } from 'vitest'

import { FUENTES_RETENCION } from '../fuentes-retencion'
import type { UnidadRetencion } from '../../types'

/**
 * Censo C (B1, lista blanca, 2026-11-26): el barrido de retención con una lectura caída. Antes:
 *  - sin las matrículas, las firmas o los niños, «nada vencido», y nada se borraba al vencer sin que nadie
 *    lo supiera;
 *  - sin «quién más sale» en las fotos del niño, `[].every(…)` es TRUE y TODAS sus fotos contaban como
 *    exclusivas: se borraban las compartidas con otros niños;
 *  - si `foto_url` no se anulaba tras borrar el fichero, la ficha nombraba un fichero que ya no existe.
 * Ahora `listar` lanza (el barrido lo anota y sigue con la siguiente fuente) y `limpiarDb` lanza (la cuenta
 * como fallida). Fixtures ficticios.
 */
const HACE_DOS_ANOS = '2024-09-01'
const estado = {
  vistas: {} as Record<string, number>,
  falla: null as { tabla: string; n: number } | null,
  filas: {} as Record<string, unknown[]>,
  escribirFalla: false,
}

function responde(tabla: string) {
  const n = (estado.vistas[tabla] = (estado.vistas[tabla] ?? 0) + 1)
  if (estado.falla?.tabla === tabla && estado.falla.n === n)
    return { data: null, error: { message: 'caída' } }
  return { data: estado.filas[tabla] ?? [], error: null }
}

const service = {
  rpc: async () => ({ data: [], error: null }),
  from: (tabla: string) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in']) c[m] = () => c
    c.update = () => ({
      eq: async () => ({ error: estado.escribirFalla ? { message: 'no' } : null }),
    })
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(responde(tabla)).then(res, rej)
    return c
  },
}

const fuente = (nombre: string) => {
  const f = FUENTES_RETENCION.find((x) => x.nombre === nombre)
  if (!f) throw new Error(`sin fuente ${nombre}`)
  return f
}
const listar = (nombre: string) => fuente(nombre).listar(service as never, new Date().toISOString())

beforeEach(() => {
  estado.vistas = {}
  estado.falla = null
  estado.escribirFalla = false
  estado.filas = {
    // El niño n-1 está de baja desde hace dos años: vencido para todas las fuentes.
    matriculas: [{ nino_id: 'n-1', fecha_baja: HACE_DOS_ANOS }],
    firmas_autorizacion: [
      {
        id: 'f-1',
        nino_id: 'n-1',
        datos: { adjuntos: [{ bucket: 'recogida-adjuntos', path: 'c-1/n-1/dni.jpg' }] },
        autorizaciones: { vigencia_hasta: null, centro_id: 'c-1' },
      },
    ],
    ninos: [{ id: 'n-1', centro_id: 'c-1', foto_url: 'c-1/n-1/perfil.jpg' }],
    media_etiquetas: [{ media_id: 'm-1', nino_id: 'n-1' }],
    media: [{ centro_id: 'c-1', path: 'c-1/a-1/p-1/foto.jpg', path_miniatura: null }],
  }
})

describe('listar con una lectura caída', () => {
  it('premisa: con todo leído, cada fuente lista al niño vencido', async () => {
    for (const nombre of ['dni-recogida', 'foto-perfil-nino', 'foto-blog-exclusiva'])
      expect(await listar(nombre), nombre).toHaveLength(1)
  })

  it.each([
    ['dni-recogida', 'matriculas', 1, /matriculas/],
    ['dni-recogida', 'firmas_autorizacion', 1, /firmas_autorizacion/],
    ['foto-perfil-nino', 'ninos', 1, /ninos/],
    ['foto-blog-exclusiva', 'media_etiquetas', 1, /del niño/],
    ['foto-blog-exclusiva', 'media_etiquetas', 2, /de sus fotos/],
    ['foto-blog-exclusiva', 'media', 1, /^media:/],
  ] as const)(
    '%s con %s n.º %s caída: no es «nada vencido», lanza',
    async (nombre, tabla, n, m) => {
      estado.falla = { tabla, n }
      await expect(listar(nombre)).rejects.toThrow(m)
    }
  )
})

describe('la foto compartida con otro niño', () => {
  beforeEach(() => {
    estado.filas.media_etiquetas = [
      { media_id: 'm-1', nino_id: 'n-1' },
      { media_id: 'm-1', nino_id: 'n-2' },
    ]
  })

  it('premisa: con todo leído, la compartida no se lista para borrar', async () => {
    expect(await listar('foto-blog-exclusiva')).toEqual([])
  })

  it('sin leer quién más sale: no la da por exclusiva, lanza', async () => {
    estado.falla = { tabla: 'media_etiquetas', n: 2 }
    await expect(listar('foto-blog-exclusiva')).rejects.toThrow(/de sus fotos/)
  })
})

describe('limpiarDb de la foto de perfil', () => {
  const unidad = { refId: 'n-1' } as UnidadRetencion
  it('premisa: anula foto_url sin error', async () => {
    await expect(fuente('foto-perfil-nino').limpiarDb!(service as never, unidad)).resolves.toBe(
      undefined
    )
  })

  it('si foto_url no se anula: lanza (el barrido la cuenta como fallida)', async () => {
    estado.escribirFalla = true
    await expect(fuente('foto-perfil-nino').limpiarDb!(service as never, unidad)).rejects.toThrow(
      /foto_url/
    )
  })
})
