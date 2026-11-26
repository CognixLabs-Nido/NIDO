import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Censo C (B1, lista blanca de `nido/lectura-mira-el-error`): las acciones de autorizaciones leían el perfil,
 * el vínculo, el niño o la plantilla sin mirar `error`, y una lectura caída decidía con un motivo FALSO
 * («el nombre no coincide», «no eres tutor», «no hay plantilla», «no es una medicación»), con una REGLA
 * (enviar con un solo firmante a un niño que exige los dos) o creando una segunda instancia de la misma
 * recogida. Ahora, con la lectura caída, contestan `common.lectura_fallida` y no escriben nada.
 *
 * Cada caso empieza por su premisa: con esa lectura bien, la acción pasa de ese punto (escribe, o sigue
 * hasta el siguiente paso). Fixtures ficticios del 2026-11-26.
 */

type Fila = Record<string, unknown>
interface Escritura {
  tabla: string
  op: 'insert' | 'update'
  valor: unknown
}

const { estado } = vi.hoisted(() => ({
  estado: {
    /** tabla -> fila (o filas) que contesta su lectura; una función recibe el nº de lectura de esa tabla. */
    filas: {} as Record<string, unknown>,
    /** La lectura que contesta error: la n-ésima de esa tabla. */
    falla: null as { tabla: string; n: number } | null,
    lecturas: {} as Record<string, number>,
    escrituras: [] as Escritura[],
    esAdmin: false,
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('../../lib/request-context', () => ({
  getRequestContext: async () => ({ ip: null, userAgent: 'test' }),
}))
vi.mock('../../lib/avisar-recogida', () => ({ avisarRecogidaFirmada: vi.fn(async () => {}) }))
vi.mock('../../lib/contenido-firmas', () => ({ conDatosDeFirmas: async () => null }))
vi.mock('@/features/alta/lib/authz-tutor', () => ({
  esAdminDeCentroDeNino: async () => estado.esAdmin,
}))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({
  esSuperusuario: async () => false,
  usuarioAdminEn: async () => true,
  usuarioResponsableEn: async () => true,
}))
vi.mock('@/features/eventos/actions/crear-evento', () => ({ crearEventoCore: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USUARIO } } }) },
    from: (tabla: string) => {
      let op: 'select' | 'insert' | 'update' = 'select'
      let valor: unknown
      const responder = (una: boolean) => {
        if (op !== 'select') {
          estado.escrituras.push({ tabla, op, valor })
          const fila = { id: `nuevo-${tabla}`, texto: 'Texto', texto_version: 1 }
          return { data: una ? fila : [fila], error: null }
        }
        const n = (estado.lecturas[tabla] = (estado.lecturas[tabla] ?? 0) + 1)
        if (estado.falla?.tabla === tabla && estado.falla.n === n)
          return { data: null, error: { code: 'XX000', message: 'caída' } }
        const f = estado.filas[tabla]
        const v = typeof f === 'function' ? (f as (n: number) => unknown)(n) : (f ?? null)
        if (una) return { data: Array.isArray(v) ? (v[0] ?? null) : v, error: null }
        return { data: v === null ? [] : Array.isArray(v) ? v : [v], error: null }
      }
      const cadena: Record<string, unknown> = {
        select: () => cadena,
        insert: (v: unknown) => ((op = 'insert'), (valor = v), cadena),
        update: (v: unknown) => ((op = 'update'), (valor = v), cadena),
        eq: () => cadena,
        is: () => cadena,
        neq: () => cadena,
        in: () => cadena,
        order: () => cadena,
        limit: () => cadena,
        maybeSingle: async () => responder(true),
        single: async () => responder(true),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(responder(false)).then(res, rej),
      }
      return cadena
    },
  }),
}))

const USUARIO = '00000000-0000-4000-8000-000000000001'
const NINO = '00000000-0000-4000-8000-000000000002'
const AUT = '00000000-0000-4000-8000-000000000003'
const FIRMA = 'data:image/png;base64,AAAA'
const LECTURA_FALLIDA = { success: false, error: 'common.lectura_fallida' }

const { crearMedicacion } = await import('../crear-medicacion')
const { crearRecogida } = await import('../crear-recogida')
const { firmarAutorizacion, rechazarAutorizacion, revocarFirma } =
  await import('../firmar-autorizacion')
const { enviarAutorizacion } = await import('../gestionar-autorizacion')
const { registrarAdministracion } = await import('../registrar-administracion')

const escribio = () => estado.escrituras.map((e) => `${e.op} ${e.tabla}`)

beforeEach(() => {
  estado.falla = null
  estado.lecturas = {}
  estado.escrituras = []
  estado.esAdmin = false
  estado.filas = {
    usuarios: { nombre_completo: 'Tutora Prueba' },
    vinculos_familiares: { tipo_vinculo: 'madre' },
    ninos: { centro_id: 'centro-1', requiere_ambos_firmantes: true },
  }
})

describe('crearMedicacion', () => {
  const entrada = {
    nino_id: NINO,
    medicacion: {
      medicamento: 'Jarabe',
      dosis: '5 ml',
      pauta: 'Cada 8 h',
      fecha_inicio: '2099-01-01',
      fecha_fin: '2099-01-10',
    },
    nombre_tecleado: 'Tutora Prueba',
    firma_imagen: FIRMA,
  }
  beforeEach(() => {
    estado.filas.autorizaciones = { id: 'plantilla-1', texto: 'Texto', texto_version: 1 }
  })

  it('premisa: con todo leído, crea la instancia y la firma', async () => {
    const r = await crearMedicacion(entrada)
    expect(r.success).toBe(true)
    expect(escribio()).toEqual(['insert autorizaciones', 'insert firmas_autorizacion'])
  })

  it.each([
    ['usuarios', 'el nombre no coincide'],
    ['vinculos_familiares', 'no eres tutor'],
    ['ninos', 'niño no encontrado'],
    ['autorizaciones', 'no hay plantilla'],
  ])('con la lectura de %s caída: no dice «%s», lo dice y no escribe', async (tabla) => {
    estado.falla = { tabla, n: 1 }
    expect(await crearMedicacion(entrada)).toEqual(LECTURA_FALLIDA)
    expect(escribio()).toEqual([])
  })
})

describe('crearRecogida', () => {
  const entrada = {
    nino_id: NINO,
    modalidad: 'habitual' as const,
    nombre_tecleado: 'Tutora Prueba',
    firma_imagen: FIRMA,
    personas: [{ nombre: 'Abuela Prueba', dni: '12345678Z' }],
  }
  // 1.ª lectura de autorizaciones: la plantilla; 2.ª: la instancia que ya hubiera (ninguna).
  beforeEach(() => {
    estado.filas.autorizaciones = (n: number) =>
      n === 1 ? { id: 'plantilla-1', titulo: 'Recogida', texto: 'Texto', texto_version: 1 } : []
  })

  it('premisa: sin instancia previa, la crea y la firma', async () => {
    const r = await crearRecogida(entrada)
    expect(r.success).toBe(true)
    expect(escribio()).toEqual(['insert autorizaciones', 'insert firmas_autorizacion'])
  })

  it.each([
    ['usuarios', 1],
    ['vinculos_familiares', 1],
    ['ninos', 1],
    ['autorizaciones', 1],
  ])('con la lectura de %s caída: lo dice y no escribe', async (tabla, n) => {
    estado.falla = { tabla, n }
    expect(await crearRecogida(entrada)).toEqual(LECTURA_FALLIDA)
    expect(escribio()).toEqual([])
  })

  it('con la búsqueda de la instancia que ya hay caída: no crea una segunda', async () => {
    estado.falla = { tabla: 'autorizaciones', n: 2 }
    expect(await crearRecogida(entrada)).toEqual(LECTURA_FALLIDA)
    expect(estado.lecturas.autorizaciones, 'premisa: falló la búsqueda, no la plantilla').toBe(2)
    expect(escribio()).toEqual([])
  })
})

describe('firmar, rechazar y revocar', () => {
  beforeEach(() => {
    estado.filas.autorizaciones = {
      id: AUT,
      centro_id: 'centro-1',
      tipo: 'medicacion',
      texto: 'Texto',
      texto_version: 1,
      estado: 'publicada',
      texto_definitivo: true,
      vigencia_desde: null,
      vigencia_hasta: null,
    }
  })
  const firmar = () =>
    firmarAutorizacion({
      autorizacion_id: AUT,
      nino_id: NINO,
      nombre_tecleado: 'Tutora Prueba',
      firma_imagen: FIRMA,
      medicacion: {
        medicamento: 'Jarabe',
        dosis: '5 ml',
        pauta: 'Cada 8 h',
        fecha_inicio: '2099-01-01',
        fecha_fin: '2099-01-10',
      },
    })
  const rechazar = () => rechazarAutorizacion({ autorizacion_id: AUT, nino_id: NINO })
  const revocar = () => revocarFirma({ autorizacion_id: AUT, nino_id: NINO })

  it('premisa: con todo leído, las tres escriben su firma', async () => {
    for (const accion of [firmar, rechazar, revocar]) {
      estado.escrituras = []
      expect((await accion()).success).toBe(true)
      expect(escribio()).toEqual(['insert firmas_autorizacion'])
    }
  })

  it.each([
    ['firmar', 'usuarios', 1, firmar],
    ['firmar', 'autorizaciones', 1, firmar],
    ['firmar', 'vinculos_familiares', 1, firmar],
    ['rechazar', 'usuarios', 1, rechazar],
    ['revocar', 'autorizaciones', 1, revocar],
    ['revocar', 'usuarios', 1, revocar],
  ] as const)('%s con la lectura de %s caída: lo dice y no firma', async (_n, tabla, n, accion) => {
    estado.falla = { tabla, n }
    expect(await accion()).toEqual(LECTURA_FALLIDA)
    expect(escribio()).toEqual([])
  })

  it('sin leer el vínculo, una admin que también es tutora no firma como Dirección', async () => {
    estado.esAdmin = true
    estado.falla = { tabla: 'vinculos_familiares', n: 1 }
    expect(await firmar()).toEqual(LECTURA_FALLIDA)
    expect(escribio()).toEqual([])
  })
})

describe('enviarAutorizacion', () => {
  const entrada = { plantilla_id: AUT, ambito: 'nino' as const, nino_id: NINO }
  beforeEach(() => {
    estado.filas.autorizaciones = {
      id: AUT,
      tipo: 'autorizacion_imagenes',
      titulo: 'Imágenes',
      texto: 'Texto',
      texto_version: 1,
      texto_definitivo: true,
      estado: 'publicada',
      centro_id: 'centro-1',
      es_plantilla: true,
    }
  })

  it('premisa: un niño que exige los dos firmantes recibe la autorización con los dos', async () => {
    await enviarAutorizacion(entrada)
    const ins = estado.escrituras.find((e) => e.tabla === 'autorizaciones')
    expect(ins?.valor).toMatchObject({ firmantes_requeridos: 'todos_los_principales' })
  })

  it('sin leer al niño: no la envía con un solo firmante', async () => {
    estado.falla = { tabla: 'ninos', n: 1 }
    expect(await enviarAutorizacion(entrada)).toEqual(LECTURA_FALLIDA)
    expect(escribio()).toEqual([])
  })
})

describe('registrarAdministracion', () => {
  const entrada = { autorizacion_id: AUT }
  beforeEach(() => {
    estado.filas.autorizaciones = {
      id: AUT,
      tipo: 'medicacion',
      es_plantilla: false,
      centro_id: 'centro-1',
      nino_id: NINO,
    }
  })

  it('premisa: con la medicación leída, pasa al siguiente paso (las firmas)', async () => {
    const r = await registrarAdministracion(entrada)
    expect(r).toEqual({ success: false, error: 'autorizaciones.errors.adm_registro_fallo' })
    expect(estado.lecturas.firmas_autorizacion).toBe(1)
  })

  it('sin leer la medicación: no dice «no es una medicación»', async () => {
    estado.falla = { tabla: 'autorizaciones', n: 1 }
    expect(await registrarAdministracion(entrada)).toEqual(LECTURA_FALLIDA)
    expect(escribio()).toEqual([])
  })
})
