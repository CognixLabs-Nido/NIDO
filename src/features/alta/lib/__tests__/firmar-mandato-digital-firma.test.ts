import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `firmarMandatoDigital` traduce SOLO `FirmaNoDecodifica` al mensaje de firma (2026-11-23). Un fallo
 * de otra parte del PDF sigue su camino: decirle a la familia «dibuja tu firma» por otra cosa la
 * mandaría a buscar donde no está. En los dos casos no se sube nada.
 */
const estado = vi.hoisted(() => ({ lanza: null as unknown, subidas: 0 }))

vi.mock('../mandato-pdf', async (original) => {
  const real = await original<typeof import('../mandato-pdf')>()
  return {
    ...real,
    generarMandatoPdf: () => {
      if (estado.lanza) throw estado.lanza
      return new Uint8Array([37, 80, 68, 70, 45])
    },
  }
})
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))

const { FirmaNoDecodifica } = await import('../mandato-pdf')
const { errorDeFirmaMandato, firmarMandatoDigital } = await import('../mandato-v3-servidor')

const supabase = {
  storage: {
    from: () => ({
      upload: async () => {
        estado.subidas += 1
        return { error: { message: 'la prueba no sube' } }
      },
    }),
  },
} as never

const firma = () =>
  firmarMandatoDigital(supabase, {
    familiaId: '00000000-0000-0000-0000-0000000000f1',
    centroId: '00000000-0000-0000-0000-0000000000c1',
    ninoId: null,
    usuarioId: '00000000-0000-0000-0000-0000000000a1',
    acreedor: { nombre: 'Centro Demo', cid: 'ES81ZZZB00000000', direccion: 'Calle 2' },
    iban: 'ES7620770024003102575766',
    titular: 'Tutor Demo',
    titularDocumento: 'X1234567L',
    titularDireccion: 'Calle Demo 1, Valencia',
    nombreTecleado: 'Tutor Demo',
    firmaImagen: 'data:image/png;base64,iVBORw0KGgo=',
    idioma: 'es',
    ipAddress: null,
    userAgent: null,
    via: 'registrar',
  })

const CLAVES = { noAutorizado: 'na', otroIban: 'oi', guardado: 'gu', subida: 'su' }

beforeEach(() => {
  estado.lanza = null
  estado.subidas = 0
})

describe('firmarMandatoDigital y el trazo que no se puede pintar', () => {
  it('control: sin fallo al componer, llega a subir', async () => {
    const r = await firma()
    expect(estado.subidas).toBe(1)
    expect(r.error?.hint).toBe('subida')
  })

  it('FirmaNoDecodifica: el error de firma (400 con la clave de firma), sin subir', async () => {
    estado.lanza = new FirmaNoDecodifica(new RangeError('Offset is outside the bounds'))
    const r = await firma()
    expect(r.error?.hint).toBe('firma')
    expect(estado.subidas).toBe(0)
    expect(errorDeFirmaMandato(r.error!, CLAVES)).toEqual({
      clave: 'alta.sepa.errors.firma',
      status: 400,
    })
  })

  it('otro fallo al componer: no se dice como firma, sigue su camino, sin subir', async () => {
    estado.lanza = new Error('plantilla del mandato desconocida: 999/es')
    await expect(firma()).rejects.toThrow(/plantilla del mandato desconocida/)
    expect(estado.subidas).toBe(0)
  })
})
