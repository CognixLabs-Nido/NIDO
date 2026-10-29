// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El botón del alta sin terminar (20261209120000), la parte del servidor. Con la invitación abierta
 * solo la cancela, sin tocar Storage. Si borra, primero los ficheros del niño y los que solo conoce
 * la base (mandatos, DNI, recogida), después la base con la acción que vio, y al final las cuentas
 * de Auth: la que no se deja borrar se queda con el email de la purga, para que el cron la vuelva a
 * coger. Si Storage falla, la base no se toca.
 */

const h = vi.hoisted(() => ({
  pasos: [] as string[],
  datos: null as unknown,
  anular: {
    data: null as unknown,
    error: null as { message: string; code?: string; hint?: string } | null,
  },
  reinvitar: {
    data: null as unknown,
    error: null as { message: string; code?: string; hint?: string } | null,
  },
  storageError: null as null | string,
  deleteUserError: null as null | { message: string },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/features/olvido/lib/fuentes-adjuntos', () => ({
  recolectarAdjuntosDe: async (_s: unknown, sujeto: { sujeto_tipo: string }) => {
    h.pasos.push(`recolectar:${sujeto.sujeto_tipo}`)
    return new Map([['ninos-fotos', ['c1/n1/foto.jpg']]])
  },
}))

const service = {
  rpc: async (fn: string, args: Record<string, unknown>) => {
    h.pasos.push(`rpc:${fn}:${JSON.stringify(args)}`)
    if (fn === 'datos_anular_alta') return { data: h.datos, error: null }
    if (fn === 'anular_alta') return h.anular
    return h.reinvitar
  },
  storage: {
    from: (b: string) => ({
      remove: async (paths: string[]) => {
        h.pasos.push(`remove:${b}:${paths.join(',')}`)
        return { data: [], error: h.storageError ? { message: h.storageError } : null }
      },
      list: async (prefijo: string) => {
        h.pasos.push(`list:${b}:${prefijo}`)
        return { data: [{ id: 'x', name: 'avatar.jpg' }], error: null }
      },
    }),
  },
  auth: {
    admin: {
      deleteUser: async (id: string) => {
        h.pasos.push(`deleteUser:${id}`)
        return { data: null, error: h.deleteUserError }
      },
      updateUserById: async (id: string, attrs: { email: string }) => {
        h.pasos.push(`anonimizar:${id}:${attrs.email}`)
        return { data: null, error: null }
      },
    },
  },
}

const { anularAltaCore, reinvitarAltaCore, DIAS_ALTA_SIN_TERMINAR } =
  await import('../alta-sin-terminar')

const BORRAR = {
  centro_id: 'c1',
  estado: 'iniciada',
  accion: 'borrar',
  familia_nueva: true,
  cuentas: ['u1'],
  mandatos: ['c1/familia/f1/mandato.pdf'],
  dnis: ['c1/n1/dni.pdf'],
  recogida: [],
}

beforeEach(() => {
  h.pasos = []
  h.datos = BORRAR
  h.anular = { data: { accion: 'borrada', cuentas: ['u1'], esperan: 0 }, error: null }
  h.reinvitar = { data: { tipo_vinculo: 'tutor_legal_principal', stubs: ['s1'] }, error: null }
  h.storageError = null
  h.deleteUserError = null
})

describe('anularAltaCore', () => {
  it('premisa: los días son los de la decisión, 30', () => {
    expect(DIAS_ALTA_SIN_TERMINAR).toBe(30)
  })

  it('con la invitación abierta solo la cancela: ni Storage ni Auth', async () => {
    h.datos = { ...BORRAR, estado: 'invitacion_abierta', accion: 'cancelar' }
    h.anular = { data: { accion: 'cancelada', invitaciones: 1 }, error: null }
    const r = await anularAltaCore(service as never, 'n1', 'dir1')
    expect(r).toEqual({ resultado: 'cancelada' })
    expect(h.pasos).toEqual([
      'rpc:datos_anular_alta:{"p_nino_id":"n1"}',
      'rpc:anular_alta:{"p_nino_id":"n1","p_actor":"dir1","p_accion":"cancelar"}',
    ])
  })

  it('al borrar: Storage antes que la base, con la acción que vio; y después Auth', async () => {
    const r = await anularAltaCore(service as never, 'n1', 'dir1')
    expect(r).toEqual({ resultado: 'borrada', cuentasBorradas: 1, cuentasEsperan: 0 })
    const i = (p: string) => h.pasos.findIndex((x) => x.startsWith(p))
    expect(h.pasos).toContain('remove:ninos-fotos:c1/n1/foto.jpg')
    expect(h.pasos).toContain('remove:mandato-sepa:c1/familia/f1/mandato.pdf')
    expect(h.pasos).toContain('remove:dni-tutores:c1/n1/dni.pdf')
    expect(i('remove:')).toBeLessThan(i('rpc:anular_alta'))
    expect(h.pasos).toContain(
      'rpc:anular_alta:{"p_nino_id":"n1","p_actor":"dir1","p_accion":"borrar"}'
    )
    expect(i('rpc:anular_alta')).toBeLessThan(i('deleteUser:u1'))
    // Solo el niño pasa por el manifiesto: los ficheros de los tutores, no (la familia de un
    // hijo anterior se queda con los suyos).
    expect(h.pasos.filter((p) => p.startsWith('recolectar:'))).toEqual(['recolectar:nino'])
    expect(h.pasos).toContain('list:usuarios-fotos:u1')
  })

  it('si Storage falla, la base no se toca', async () => {
    h.storageError = 'caído'
    await expect(anularAltaCore(service as never, 'n1', 'dir1')).rejects.toThrow('Storage')
    expect(h.pasos.some((p) => p.startsWith('rpc:anular_alta'))).toBe(false)
  })

  it('si el alta cambió entre medias, el error sube con su HINT y no se borra Auth', async () => {
    h.anular = {
      data: null,
      error: { message: 'el alta ha cambiado', code: '40001', hint: 'el_alta_ha_cambiado' },
    }
    await expect(anularAltaCore(service as never, 'n1', 'dir1')).rejects.toMatchObject({
      code: '40001',
      hint: 'el_alta_ha_cambiado',
    })
    expect(h.pasos.some((p) => p.startsWith('deleteUser'))).toBe(false)
  })

  it('la cuenta que Auth no deja borrar se queda con el email de la purga', async () => {
    h.deleteUserError = { message: 'caído' }
    await anularAltaCore(service as never, 'n1', 'dir1')
    expect(h.pasos).toContain('anonimizar:u1:borrado+u1@borrado.invalid')
  })

  it('si ya no es un alta sin terminar, no hace nada', async () => {
    h.datos = null
    expect(await anularAltaCore(service as never, 'n1', 'dir1')).toEqual({ resultado: 'ya_no' })
    expect(h.pasos).toEqual(['rpc:datos_anular_alta:{"p_nino_id":"n1"}'])
  })
})

describe('reinvitarAltaCore', () => {
  it('corrige en la base y borra de Auth la cuenta del email viejo', async () => {
    const r = await reinvitarAltaCore(service as never, 'n1', 'bueno@nido.test', 'dir1')
    expect(r).toEqual({ tipoVinculo: 'tutor_legal_principal' })
    expect(h.pasos[0]).toBe(
      'rpc:reinvitar_alta:{"p_nino_id":"n1","p_email":"bueno@nido.test","p_actor":"dir1"}'
    )
    expect(h.pasos).toContain('deleteUser:s1')
  })

  it('con el alta empezada, el error sube con su HINT', async () => {
    h.reinvitar = {
      data: null,
      error: { message: 'ya empezó', code: '55000', hint: 'alta_iniciada' },
    }
    await expect(
      reinvitarAltaCore(service as never, 'n1', 'bueno@nido.test', 'dir1')
    ).rejects.toMatchObject({ hint: 'alta_iniciada' })
  })
})
