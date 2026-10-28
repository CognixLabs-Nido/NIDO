import { describe, expect, it } from 'vitest'

import { FUENTES_RETENCION } from '../fuentes-retencion'
import type { UnidadRetencion } from '../../types'

/**
 * Las limpiezas de BD del barrido que borran filas auditadas van por RPC (20261129120000): el
 * borrado se lleva sus copias en audit_log. Un DELETE desde la app con service_role las dejaría.
 */

type Llamada = string
type Respuestas = Record<string, { data?: unknown; error: { message: string } | null }>

function servicio(respuestas: Respuestas = {}) {
  const llamadas: Llamada[] = []
  const service = {
    rpc: async (fn: string) => {
      llamadas.push(`rpc:${fn}`)
      return respuestas[fn] ?? { data: true, error: null }
    },
    from: (tabla: string) => {
      llamadas.push(`from:${tabla}`)
      throw new Error(`la limpieza no debe tocar ${tabla} directamente`)
    },
    auth: {
      admin: {
        deleteUser: async () => {
          llamadas.push('deleteUser')
          return { error: null }
        },
      },
    },
  }
  return { service, llamadas }
}

function fuente(nombre: string) {
  const f = FUENTES_RETENCION.find((x) => x.nombre === nombre)
  if (!f?.limpiarDb) throw new Error(`fuente ${nombre} sin limpiarDb`)
  return f.limpiarDb
}

const unidad = { refId: '00000000-0000-4000-8000-000000000001' } as UnidadRetencion

describe('limpiarDb sin copia en audit_log', () => {
  it('foto-blog-exclusiva: una sola RPC, sin DELETE directo', async () => {
    const { service, llamadas } = servicio()
    await fuente('foto-blog-exclusiva')(service as never, unidad)
    expect(llamadas).toEqual(['rpc:purgar_fotos_blog_nino'])
  })

  it('foto-blog-exclusiva: un error de la RPC se lanza (el barrido lo cuenta como fallido)', async () => {
    const { service } = servicio({ purgar_fotos_blog_nino: { error: { message: 'caído' } } })
    await expect(fuente('foto-blog-exclusiva')(service as never, unidad)).rejects.toThrow('caído')
  })

  it('esqueleto-huerfano-stub: re-valida, borra su fila de usuarios y después la cuenta', async () => {
    const { service, llamadas } = servicio()
    await fuente('esqueleto-huerfano-stub')(service as never, unidad)
    expect(llamadas).toEqual([
      'rpc:es_esqueleto_stub_purgable',
      'rpc:purgar_esqueleto_stub_db',
      'deleteUser',
    ])
  })

  it('esqueleto-huerfano-stub: si falla la fila de usuarios, no borra la cuenta', async () => {
    const { service, llamadas } = servicio({
      purgar_esqueleto_stub_db: { error: { message: 'no es stub' } },
    })
    await expect(fuente('esqueleto-huerfano-stub')(service as never, unidad)).rejects.toThrow(
      'no es stub'
    )
    expect(llamadas).not.toContain('deleteUser')
  })
})
