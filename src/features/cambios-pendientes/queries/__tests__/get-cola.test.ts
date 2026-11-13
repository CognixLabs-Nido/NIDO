import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La cola enseña antes → después de cada campo que cambia, en TODAS las entradas (2026-11-08). El
 * «antes» es lo guardado hoy, leído con la sesión; si esa lectura falla, la entrada sale sin líneas
 * (`null`) y la pantalla lo dice: nunca un «antes» inventado.
 */

vi.mock('server-only', () => ({}))
const warnSpy = vi.fn()
vi.mock('@/shared/lib/logger', () => ({ logger: { warn: (...a: unknown[]) => warnSpy(...a) } }))

const NINO = '11111111-1111-4111-8111-111111111111'
const FAMILIA = '33333333-3333-4333-8333-333333333333'

const FICHA = {
  id: NINO,
  familia_id: FAMILIA,
  nombre: 'Lucía',
  primer_apellido: 'Garcia',
  segundo_apellido: 'López',
  fecha_nacimiento: '2024-03-15',
  sexo: 'F',
  nacionalidad: 'española',
  lugar_nacimiento: null,
  dni: null,
  direccion_calle: 'Mayor',
  direccion_numero: '1',
  direccion_cp: '46001',
  direccion_ciudad: 'Valencia',
  estado_civil_familia: 'casados',
  libro_familia_path: null,
}
const TITULAR = {
  familia_id: FAMILIA,
  rol_familia: 'titular',
  email: 'madre@ejemplo.invalid',
  nombre_completo: 'Madre Demo',
  direccion_calle: 'Mayor',
  direccion_numero: '1',
  direccion_cp: '46001',
  direccion_ciudad: 'Valencia',
  dni_documento_path: 'c/n/dni.pdf',
  // Fase 6: por `tutores_de_familia`, con los cinco nuevos y si se pudieron leer.
  telefono: '+34600000001',
  fecha_nacimiento: '1985-01-01',
  dni_numero: '12345678Z',
  estudios: null,
  empresa: null,
  ve_personales: true,
}

const fila = (id: string, entidad: string, payload: unknown) => ({
  id,
  entidad,
  nino_id: NINO,
  payload,
  created_at: '2026-11-08T10:00:00Z',
  nino: { nombre: 'Lucía' },
  solicitante: { nombre_completo: 'Madre Demo' },
})

const estado = { ninosError: false }
let FILAS: ReturnType<typeof fila>[] = []

function fake() {
  return {
    from: (tabla: string) => {
      if (tabla === 'cambios_pendientes')
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ order: () => Promise.resolve({ data: FILAS, error: null }) }),
            }),
          }),
        }
      if (tabla === 'ninos')
        return {
          select: () => ({
            in: () =>
              Promise.resolve(
                estado.ninosError
                  ? { data: null, error: { code: '42501', message: 'x' } }
                  : { data: [FICHA], error: null }
              ),
          }),
        }
      return {
        select: () => ({
          in: () => ({ is: () => Promise.resolve({ data: [TITULAR], error: null }) }),
        }),
      }
    },
    // Lo de gestión de la ficha sale por su función (`20270115120000`); el falso lo saca de FICHA.
    rpc: (fn: string) => {
      // Lo guardado del tutor sale por `tutores_de_familia` desde la fase 6 (la sesión no lee los cinco).
      if (fn === 'tutores_de_familia') return Promise.resolve({ data: [TITULAR], error: null })
      // Fase 7: la tarjeta sanitaria guardada, por `sip_de_ninos`.
      if (fn === 'sip_de_ninos')
        return Promise.resolve({
          data: [{ nino_id: FICHA.id, sip: null, sip_documento_path: null, ve_documento: true }],
          error: null,
        })
      if (fn !== 'ficha_gestion_ninos') throw new Error(`rpc no prevista: ${fn}`)
      return Promise.resolve(
        estado.ninosError
          ? { data: null, error: { code: 'XX000', message: 'x' } }
          : { data: [{ nino_id: FICHA.id, ...FICHA }], error: null }
      )
    },
  }
}
vi.mock('@/lib/supabase/server', () => ({ createClient: () => Promise.resolve(fake()) }))

import { listarCambiosPendientes } from '../get-cola'

beforeEach(() => {
  vi.clearAllMocks()
  estado.ninosError = false
})

describe('listarCambiosPendientes — antes → después', () => {
  it('cada entidad enseña lo guardado y lo propuesto de lo que cambia', async () => {
    FILAS = [
      fila('a', 'ninos_identidad', { primer_apellido: 'García', dni: '12345678Z' }),
      fila('b', 'ninos_familia', { direccion_ciudad: 'Alzira' }),
      // El tutor manda los seis campos; solo el email cambia.
      fila('c', 'datos_tutor', {
        tipo_vinculo: 'tutor_legal_principal',
        email: 'otra@ejemplo.invalid',
        nombre_completo: 'Madre Demo',
        direccion_calle: 'Mayor',
        direccion_numero: '1',
        direccion_cp: '46001',
        direccion_ciudad: 'Valencia',
      }),
      fila('d', 'ninos_libro_familia', { path: 'c/n/libro.pdf' }),
      fila('e', 'datos_tutor_dni', { tipo_vinculo: 'tutor_legal_principal', path: 'c/n/dni2.pdf' }),
    ]
    const items = await listarCambiosPendientes('centro')
    const por = Object.fromEntries(items.map((i) => [i.id, i.lineas]))

    expect(items).toHaveLength(5) // premisa: las cinco entradas llegan
    expect(por.a).toEqual([
      { campo: 'primer_apellido', antes: 'Garcia', despues: 'García' },
      { campo: 'dni', antes: null, despues: '12345678Z' },
    ])
    expect(por.b).toEqual([{ campo: 'direccion_ciudad', antes: 'Valencia', despues: 'Alzira' }])
    expect(por.c).toEqual([
      { campo: 'email', antes: 'madre@ejemplo.invalid', despues: 'otra@ejemplo.invalid' },
    ])
    expect(por.d).toEqual([{ campo: 'documento', antes: null, despues: 'nuevo' }])
    expect(por.e).toEqual([{ campo: 'documento', antes: 'c/n/dni.pdf', despues: 'nuevo' }])
  })

  it('si no se puede leer lo guardado, la entrada sale sin líneas, y el log no lleva valores', async () => {
    estado.ninosError = true
    FILAS = [fila('a', 'ninos_identidad', { dni: '12345678Z' })]
    const items = await listarCambiosPendientes('centro')

    expect(items).toHaveLength(1) // premisa: la entrada llega
    expect(items[0]!.lineas).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('12345678Z')
  })
})
