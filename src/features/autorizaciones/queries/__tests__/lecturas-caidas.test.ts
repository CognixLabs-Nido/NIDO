import { beforeEach, describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * Censo C (B1, lista blanca de `nido/lectura-mira-el-error`): las consultas de autorizaciones tomaban una
 * lectura caída por «no hay». El estado de una medicación firmada salía «sin firmar» (sin vínculos ni
 * firmas), el panel de la imagen decía que nadie había consentido, la familia veía «el centro no tiene
 * plantilla» y el listado de medicación «0 dadas». Ahora lanzan `LecturaFallida`, y la página la pinta con
 * su `error.tsx` («No se ha podido leer»).
 *
 * Cada caso empieza por su premisa: con todo leído, la consulta devuelve lo que se mide. Fixtures ficticios
 * del 2026-11-26.
 */

const { estado } = vi.hoisted(() => ({
  estado: {
    filas: {} as Record<string, unknown>,
    falla: null as { tabla: string; n: number } | null,
    lecturas: {} as Record<string, number>,
  },
}))

function cliente() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    rpc: async () => ({ data: [], error: null }),
    from: (tabla: string) => {
      const responder = (una: boolean) => {
        const n = (estado.lecturas[tabla] = (estado.lecturas[tabla] ?? 0) + 1)
        if (estado.falla?.tabla === tabla && estado.falla.n === n)
          return { data: null, error: { code: 'XX000', message: 'caída' } }
        const f = estado.filas[tabla]
        const v = typeof f === 'function' ? (f as (n: number) => unknown)(n) : (f ?? null)
        if (una) return { data: Array.isArray(v) ? (v[0] ?? null) : v, error: null }
        return { data: v === null ? [] : Array.isArray(v) ? v : [v], error: null }
      }
      const cadena: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'not', 'neq', 'order', 'limit'])
        cadena[m] = () => cadena
      cadena.maybeSingle = async () => responder(true)
      cadena.single = async () => responder(true)
      cadena.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(responder(false)).then(res, rej)
      return cadena
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => cliente() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => cliente() }))
vi.mock('../../lib/contenido-firmas', () => ({
  conDatosDeFirmas: async (_s: unknown, f: unknown[]) =>
    f.map((x) => ({ ...(x as object), datos: null })),
}))

const { getEstadoFirmaPorInstancia } = await import('../estado-firma-instancias')
const { getAdministracionesPorAutorizacion } = await import('../get-administraciones')
const { getAutorizacionDetalle } = await import('../get-autorizacion-detalle')
const { getMedicacionContextoFamilia } = await import('../get-medicacion-familia')
const { getMedicacionesConActividad } = await import('../get-medicaciones-actividad')
const { getRecogidaContextoFamilia } = await import('../get-recogida-familia')

const NINO = 'nino-1'
const ambito = { centroId: 'centro-1', hijos: [{ id: NINO }] } as unknown as Parameters<
  typeof getMedicacionContextoFamilia
>[0]

async function lanzaLecturaFallida(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err
  )
  expect(esLecturaFallida(e), `esperaba una LecturaFallida, llegó ${String(e)}`).toBe(true)
}

beforeEach(() => {
  estado.falla = null
  estado.lecturas = {}
  estado.filas = {
    ninos: [{ id: NINO, nombre: 'Niño', apellidos: 'Demo', requiere_ambos_firmantes: false }],
    vinculos_familiares: [
      { nino_id: NINO, usuario_id: 'u-1', tipo_vinculo: 'tutor_legal_principal' },
    ],
    firmas_autorizacion: [
      {
        id: 'f-1',
        autorizacion_id: 'aut-1',
        nino_id: NINO,
        firmante_id: 'u-1',
        decision: 'firmado',
        firmado_at: '2026-11-26T10:00:00Z',
      },
    ],
    usuarios: [{ id: 'u-1', nombre_completo: 'Tutora Demo' }],
    consentimientos: [{ nino_id: NINO, usuario_id: 'u-1' }],
  }
})

describe('getEstadoFirmaPorInstancia', () => {
  const instancias = [{ id: 'aut-1', nino_id: NINO, firmantes_requeridos: 'uno_principal' }]
  const leer = () =>
    getEstadoFirmaPorInstancia(
      cliente() as never,
      instancias as Parameters<typeof getEstadoFirmaPorInstancia>[1]
    )

  it('premisa: con todo leído, la medicación firmada sale firmada', async () => {
    expect((await leer()).get('aut-1')).toBe('firmado')
  })

  it.each(['ninos', 'vinculos_familiares', 'firmas_autorizacion'])(
    'con %s caída: no dice «sin firmar», lanza',
    async (tabla) => {
      estado.falla = { tabla, n: 1 }
      await lanzaLecturaFallida(leer())
    }
  )
})

describe('getAdministracionesPorAutorizacion', () => {
  beforeEach(() => {
    estado.filas.administraciones_medicacion = [
      {
        id: 'adm-1',
        administrado_por: 'u-1',
        administrado_en: '2026-11-26T10:00:00Z',
        medicamento: 'Jarabe',
        dosis: '5 ml',
        notas: null,
        confirmado_por: null,
        confirmado_at: null,
      },
    ]
  })

  it('premisa: con todo leído, sale la dosis con quién la dio', async () => {
    const r = await getAdministracionesPorAutorizacion('aut-1')
    expect(r.map((a) => a.administrado_por_nombre)).toEqual(['Tutora Demo'])
  })

  it.each(['administraciones_medicacion', 'usuarios'])('con %s caída: lanza', async (tabla) => {
    estado.falla = { tabla, n: 1 }
    await lanzaLecturaFallida(getAdministracionesPorAutorizacion('aut-1'))
  })
})

describe('getAutorizacionDetalle (el roster)', () => {
  beforeEach(() => {
    estado.filas.autorizaciones = {
      id: 'aut-1',
      tipo: 'autorizacion_imagenes',
      titulo: 'Imágenes',
      texto: 'Texto',
      texto_version: 1,
      texto_definitivo: true,
      estado: 'publicada',
      firmantes_requeridos: 'uno_principal',
      evento_id: null,
      nino_id: NINO,
      aula_id: null,
      es_plantilla: false,
      ambito: 'nino',
      plantilla_id: 'p-1',
      centro_id: 'centro-1',
      vigencia_desde: null,
      vigencia_hasta: null,
      creado_por: 'u-2',
    }
  })

  it('premisa: con todo leído, el niño sale firmado y con el nombre de quien firmó', async () => {
    const d = await getAutorizacionDetalle('aut-1')
    expect(d?.roster.map((r) => [r.estado, r.firmantes.map((f) => f.firmante_nombre)])).toEqual([
      ['firmado', ['Tutora Demo']],
    ])
  })

  it.each(['ninos', 'vinculos_familiares', 'firmas_autorizacion', 'usuarios', 'consentimientos'])(
    'con %s caída: lanza (no «sin firmar», ni «nadie ha consentido»)',
    async (tabla) => {
      estado.falla = { tabla, n: 1 }
      await lanzaLecturaFallida(getAutorizacionDetalle('aut-1'))
    }
  )
})

describe('getMedicacionesConActividad', () => {
  beforeEach(() => {
    estado.filas.autorizaciones = [
      {
        id: 'aut-1',
        nino_id: NINO,
        titulo: 'Jarabe',
        estado: 'publicada',
        vigencia_desde: null,
        vigencia_hasta: null,
        firmantes_requeridos: 'uno_principal',
        created_at: '2026-11-26T09:00:00Z',
        archivada_at: null,
      },
    ]
    estado.filas.administraciones_medicacion = [{ autorizacion_id: 'aut-1', confirmado_por: null }]
  })

  it('premisa: con todo leído, sale con su dosis por confirmar y firmada', async () => {
    const [m] = await getMedicacionesConActividad('centro-1')
    expect(m).toMatchObject({ estadoFirma: 'firmado' })
    expect(JSON.stringify(m)).toContain('Niño Demo')
    // Dos lecturas de `ninos`: la de los nombres y la del estado de firma (getEstadoFirmaPorInstancia).
    // Cada caso de abajo tumba UNA; sin esto, «ninos caída» podía caer en la otra y no probar nada.
    expect(estado.lecturas.ninos, 'premisa: dos lecturas de ninos').toBe(2)
  })

  it.each([
    ['autorizaciones', 1],
    ['administraciones_medicacion', 1],
    ['ninos', 1],
    ['ninos', 2],
  ])(
    'con %s (lectura %i) caída: no dice «no hay medicación» ni «0 dadas», lanza',
    async (tabla, n) => {
      estado.falla = { tabla, n }
      await lanzaLecturaFallida(getMedicacionesConActividad('centro-1'))
    }
  )
})

describe('el contexto de la familia (medicación y recogida)', () => {
  beforeEach(() => {
    // 1.ª lectura de autorizaciones: la plantilla; 2.ª (recogida): las habituales.
    estado.filas.autorizaciones = (n: number) =>
      n === 1 ? { id: 'plantilla-1' } : [{ id: 'aut-1', nino_id: NINO }]
  })

  it('premisa: con todo leído, hay plantilla y el hijo', async () => {
    expect(await getMedicacionContextoFamilia(ambito)).toMatchObject({
      plantillaDisponible: true,
      ninos: [{ id: NINO }],
    })
    estado.lecturas = {}
    expect(await getRecogidaContextoFamilia(ambito)).toMatchObject({ plantillaDisponible: true })
    expect(estado.lecturas.firmas_autorizacion, 'premisa: llegó a leer las firmas').toBe(1)
  })

  it.each([
    ['ninos', 1],
    ['autorizaciones', 1],
  ])('medicación con %s caída: no dice «sin plantilla» ni «sin hijos», lanza', async (tabla, n) => {
    estado.falla = { tabla, n }
    await lanzaLecturaFallida(getMedicacionContextoFamilia(ambito))
  })

  it.each([
    ['ninos', 1],
    ['autorizaciones', 1],
    ['autorizaciones', 2],
    ['firmas_autorizacion', 1],
  ])('recogida con %s (lectura %i) caída: lanza', async (tabla, n) => {
    estado.falla = { tabla, n }
    await lanzaLecturaFallida(getRecogidaContextoFamilia(ambito))
  })
})
