// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El expediente por tiempo (20261204120000): el cron lista los niños vencidos con los años de la
 * constante; en simulación solo cuenta; en real, por cada niño borra antes sus ficheros de Storage
 * (con el manifiesto del olvido) y después llama a la purga. Un niño que falla no tumba a los demás
 * ni al resto del cron.
 */

const h = vi.hoisted(() => ({
  pasos: [] as string[],
  vencidos: { data: null as unknown, error: null as { message: string } | null },
  purga: (_nino: string): { data: unknown; error: { message: string } | null } => ({
    data: true,
    error: null,
  }),
  errores: [] as unknown[][],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/logger', () => ({
  logger: { error: (...a: unknown[]) => h.errores.push(a), warn: vi.fn() },
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.pasos.push(`rpc:${fn}:${JSON.stringify(args)}`)
      if (fn === 'expedientes_vencidos') return h.vencidos
      return h.purga(args.p_nino_id as string)
    },
  }),
}))
vi.mock('@/features/olvido/lib/fuentes-adjuntos', () => ({
  recolectarAdjuntosDe: async (
    _s: unknown,
    sujeto: { sujeto_tipo: string; sujeto_id: string; centro_id: string },
    esUltimo: boolean
  ) => {
    h.pasos.push(
      `recolectar:${sujeto.sujeto_tipo}:${sujeto.sujeto_id}:${sujeto.centro_id}:${esUltimo}`
    )
    return new Map([['ninos-fotos', [`c/${sujeto.sujeto_id}/foto.jpg`]]])
  },
}))
vi.mock('@/shared/lib/adjuntos/storage', () => ({
  borrarObjetosBucket: async (_s: unknown, bucket: string, paths: string[]) => {
    h.pasos.push(`borrar:${bucket}:${paths.join(',')}`)
  },
}))

const { purgarExpedientes } = await import('../lib/expediente')
const { RETENCION_EXPEDIENTE_ANIOS } = await import('../types')

const DOS = [
  { nino_id: 'n1', centro_id: 'c1' },
  { nino_id: 'n2', centro_id: 'c1' },
]

beforeEach(() => {
  h.pasos = []
  h.errores = []
  h.vencidos = { data: DOS, error: null }
  h.purga = () => ({ data: true, error: null })
})

describe('purgarExpedientes', () => {
  it('premisa: el plazo es el de la tabla, 5 años', () => {
    expect(RETENCION_EXPEDIENTE_ANIOS).toBe(5)
  })

  it('en simulación lista con los años de la constante y solo cuenta', async () => {
    const r = await purgarExpedientes({ dryRun: true })
    expect(r).toEqual({ dryRun: true, vencidos: 2, purgados: 0, fallidos: 0 })
    expect(h.pasos).toEqual([`rpc:expedientes_vencidos:{"p_anios":${RETENCION_EXPEDIENTE_ANIOS}}`])
  })

  it('en real, por cada niño: Storage antes que la BD, con el manifiesto del niño', async () => {
    const r = await purgarExpedientes({ dryRun: false })
    expect(r).toEqual({ dryRun: false, vencidos: 2, purgados: 2, fallidos: 0 })
    expect(h.pasos).toEqual([
      `rpc:expedientes_vencidos:{"p_anios":5}`,
      'recolectar:nino:n1:c1:true',
      'borrar:ninos-fotos:c/n1/foto.jpg',
      `rpc:purgar_expediente_nino:{"p_nino_id":"n1","p_anios":5}`,
      'recolectar:nino:n2:c1:true',
      'borrar:ninos-fotos:c/n2/foto.jpg',
      `rpc:purgar_expediente_nino:{"p_nino_id":"n2","p_anios":5}`,
    ])
  })

  it('un niño que falla se cuenta y los demás siguen', async () => {
    h.purga = (nino) =>
      nino === 'n1' ? { data: null, error: { message: 'boom' } } : { data: true, error: null }
    const r = await purgarExpedientes({ dryRun: false })
    expect(r).toEqual({ dryRun: false, vencidos: 2, purgados: 1, fallidos: 1 })
    expect(h.errores).toHaveLength(1)
    expect(h.errores[0]).toContain('n1')
  })

  it('el que la BD ya no purga (lo reincorporaron entre medias) no cuenta como purgado', async () => {
    h.purga = (nino) => ({ data: nino !== 'n2', error: null })
    const r = await purgarExpedientes({ dryRun: false })
    expect(r).toEqual({ dryRun: false, vencidos: 2, purgados: 1, fallidos: 0 })
  })

  it('si no se puede listar, NULL y no se toca nada', async () => {
    h.vencidos = { data: null, error: { message: 'caído' } }
    const r = await purgarExpedientes({ dryRun: false })
    expect(r).toEqual({ dryRun: false, vencidos: null, purgados: 0, fallidos: 0 })
    expect(h.pasos).toHaveLength(1)
    expect(h.errores).toHaveLength(1)
  })

  it('una respuesta con otra forma tampoco se toma por una lista', async () => {
    h.vencidos = { data: { nino_id: 'n1' }, error: null }
    const r = await purgarExpedientes({ dryRun: false })
    expect(r.vencidos).toBeNull()
    expect(h.pasos).toHaveLength(1)
  })
})
