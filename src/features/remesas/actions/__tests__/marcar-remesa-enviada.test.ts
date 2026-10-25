import { beforeEach, describe, expect, it, vi } from 'vitest'

import { marcarRemesaEnviada } from '../marcar-remesa-enviada'

/**
 * La remesa pasa a enviada ANTES de leer sus recibos (`20261120120000`): desde ese momento la BD no
 * deja añadirle ninguno, así que los que se leen después son todos. Leídos antes, uno añadido entre
 * medias quedaría en una remesa enviada sin pasar a enviado_banco.
 */

const { pasos, admin } = vi.hoisted(() => ({
  pasos: [] as string[],
  admin: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({ usuarioAdminEn: admin }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => ({
      select: () => {
        if (tabla === 'recibos_remesa') {
          return {
            eq: async () => {
              pasos.push('leer recibos')
              return { data: [{ recibo_id: 'r1' }, { recibo_id: 'r2' }] }
            },
          }
        }
        return {
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({
                data: { id: 'rem', centro_id: 'c1', estado: 'borrador' },
              }),
            }),
          }),
        }
      },
      update: () => ({
        eq: () => {
          if (tabla === 'remesas') {
            return {
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => {
                    pasos.push('remesa enviada')
                    return { data: { id: 'rem' }, error: null }
                  },
                }),
              }),
            }
          }
          return {}
        },
        in: async (_col: string, ids: string[]) => {
          pasos.push(`recibos enviados: ${ids.join(',')}`)
          return { error: null }
        },
      }),
    }),
  }),
}))

describe('marcarRemesaEnviada', () => {
  beforeEach(() => {
    pasos.length = 0
    admin.mockReset().mockResolvedValue('u1')
  })

  it('primero la remesa, después la lectura de sus recibos, y esos pasan a enviado_banco', async () => {
    expect(await marcarRemesaEnviada({ remesaId: '11111111-1111-4111-8111-111111111111' })).toEqual(
      { success: true, data: null }
    )
    expect(pasos).toEqual(['remesa enviada', 'leer recibos', 'recibos enviados: r1,r2'])
  })
})
