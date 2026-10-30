// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `barrerRetencion` (20261213120000): primero el registro, luego el borrado. Cada unidad vencida
 * deja su fila en `retencion_ejecuciones` antes de tocar Storage o la BD; si esa escritura falla
 * (supabase-js no lanza: devuelve `error`), la unidad no se borra, cuenta como fallida y la
 * siguiente sigue. En simulación también se registra, y no se borra nada.
 */

const h = vi.hoisted(() => ({
  pasos: [] as string[],
  insertError: (_refId: string): { message: string } | null => null,
  errores: [] as unknown[][],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/logger', () => ({
  logger: { error: (...a: unknown[]) => h.errores.push(a), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/shared/lib/adjuntos/storage', () => ({
  borrarObjetosBucket: async (_s: unknown, bucket: string, paths: string[]) => {
    h.pasos.push(`storage:${bucket}:${paths.join(',')}`)
  },
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: (tabla: string) => ({
      insert: async (fila: { ref_id: string; accion: string }) => {
        h.pasos.push(`insert:${tabla}:${fila.ref_id}:${fila.accion}`)
        return { data: null, error: h.insertError(fila.ref_id) }
      },
    }),
  }),
}))
vi.mock('../lib/fuentes-retencion', () => ({
  FUENTES_RETENCION: [
    {
      nombre: 'fuente-de-prueba',
      categoria: 'foto_perfil_nino',
      listar: async () =>
        ['u1', 'u2'].map((refId) => ({
          categoria: 'foto_perfil_nino',
          centroId: 'c1',
          refTipo: 'nino',
          refId,
          bucket: 'ninos-fotos',
          paths: [`c1/${refId}/foto.jpg`],
          motivo: 'baja_12m',
        })),
      limpiarDb: async (_s: unknown, u: { refId: string }) => {
        h.pasos.push(`limpiarDb:${u.refId}`)
      },
    },
  ],
}))

const { barrerRetencion } = await import('../actions/barrer-retencion')

beforeEach(() => {
  h.pasos = []
  h.errores = []
  h.insertError = () => null
})

describe('barrerRetencion', () => {
  it('premisa: con el registro bien, en real registra y después borra cada unidad', async () => {
    const r = await barrerRetencion({ dryRun: false })
    expect(r).toEqual({
      success: true,
      data: {
        dryRun: false,
        total: 2,
        objetosPurgados: 2,
        fallidos: 0,
        porCategoria: { foto_perfil_nino: 2 },
      },
    })
    expect(h.pasos).toEqual([
      'insert:retencion_ejecuciones:u1:purgado',
      'storage:ninos-fotos:c1/u1/foto.jpg',
      'limpiarDb:u1',
      'insert:retencion_ejecuciones:u2:purgado',
      'storage:ninos-fotos:c1/u2/foto.jpg',
      'limpiarDb:u2',
    ])
  })

  it('si el registro de una unidad falla, esa unidad no se borra y la siguiente sigue', async () => {
    h.insertError = (refId) => (refId === 'u1' ? { message: 'permission denied' } : null)
    const r = await barrerRetencion({ dryRun: false })

    expect(h.pasos).toEqual([
      'insert:retencion_ejecuciones:u1:purgado',
      'insert:retencion_ejecuciones:u2:purgado',
      'storage:ninos-fotos:c1/u2/foto.jpg',
      'limpiarDb:u2',
    ])
    expect(r).toEqual({
      success: true,
      data: {
        dryRun: false,
        total: 2,
        objetosPurgados: 1,
        fallidos: 1,
        porCategoria: { foto_perfil_nino: 1 },
      },
    })
    expect(h.errores).toHaveLength(1)
    expect(String(h.errores[0])).toContain('permission denied')
  })

  it('en simulación registra cada unidad como simulada y no borra nada', async () => {
    const r = await barrerRetencion({ dryRun: true })
    expect(h.pasos).toEqual([
      'insert:retencion_ejecuciones:u1:simulado',
      'insert:retencion_ejecuciones:u2:simulado',
    ])
    expect(r).toEqual({
      success: true,
      data: {
        dryRun: true,
        total: 2,
        objetosPurgados: 0,
        fallidos: 0,
        porCategoria: { foto_perfil_nino: 2 },
      },
    })
  })

  it('en simulación, un registro que falla cuenta como fallido: no queda constancia', async () => {
    h.insertError = () => ({ message: 'violates check constraint' })
    const r = await barrerRetencion({ dryRun: true })
    expect(r).toEqual({
      success: true,
      data: { dryRun: true, total: 2, objetosPurgados: 0, fallidos: 2, porCategoria: {} },
    })
  })
})
