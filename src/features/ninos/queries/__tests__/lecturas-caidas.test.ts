import { beforeEach, describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * Censo C (B1, lista blanca de `nido/lectura-mira-el-error`, 2026-11-26): las consultas de niños tomaban
 * una lectura caída por «no hay».
 *  - la lista de niños, sin las matrículas: vacía («no hay niños»: el filtro de alumnos no veía ninguno);
 *  - la ficha de Dirección: sin matrículas, sin recorrido, o sin motivo de baja;
 *  - el recorrido de la familia: «sin recorrido»;
 *  - el resumen del alta: sin la familia o sin el mandato, «sin mandato»; sin el consentimiento médico,
 *    «sin consentimiento» (y es lo que mira Dirección antes de validar).
 * Ahora lanzan `LecturaFallida` y la pinta el `error.tsx` de la sección. Cada bloque empieza por su
 * premisa. Fixtures ficticios.
 */
const { estado } = vi.hoisted(() => ({
  estado: {
    filas: {} as Record<string, unknown>,
    rpcs: {} as Record<string, unknown>,
    falla: null as string | null,
    leidas: [] as string[],
  },
}))

const CAIDA = { code: 'XX000', message: 'caída' }

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async (fn: string) => {
      estado.leidas.push(fn)
      if (estado.falla === fn) return { data: null, error: CAIDA }
      return { data: estado.rpcs[fn] ?? [], error: null }
    },
    from: (tabla: string) => {
      const responder = (una: boolean) => {
        estado.leidas.push(tabla)
        if (estado.falla === tabla) return { data: null, error: CAIDA }
        const v = estado.filas[tabla] ?? null
        if (una) return { data: Array.isArray(v) ? (v[0] ?? null) : v, error: null }
        return { data: v === null ? [] : Array.isArray(v) ? v : [v], error: null }
      }
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) c[m] = () => c
      c.maybeSingle = async () => responder(true)
      c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(responder(false)).then(res, rej)
      return c
    },
  }),
}))
vi.mock('@/features/alta/lib/tutores-familia', () => ({
  leerTutoresDeNino: async () => ({
    leidos: true,
    error: null,
    tutores: [
      { id: 't-1', usuario_id: 'u-1', nombre_completo: 'Tutora Demo', dni_documento_path: null },
    ],
  }),
}))
vi.mock('@/features/ninos/lib/ficha-gestion', () => ({
  leerFichaGestionDe: async () => ({ libro_familia_path: null }),
}))
vi.mock('@/shared/lib/adjuntos/storage', () => ({
  BUCKET_DNI_TUTORES: 'dni',
  BUCKET_LIBRO_FAMILIA: 'libro',
  firmarRuta: async () => null,
  firmarRutasBucket: async () => new Map(),
}))

const { getNinosPorCentro, getMatriculasPorNino, getHistoricoMatriculas } =
  await import('../get-ninos')
const { getRecorridoNinoFamilia } = await import('../get-recorrido-familia')
const { getAltaDocumentacion } = await import('../get-alta-documentacion')

async function lanzaEn(p: Promise<unknown>, donde: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err
  )
  expect(esLecturaFallida(e), `esperaba una LecturaFallida, llegó ${String(e)}`).toBe(true)
  expect((e as { donde: string }).donde).toBe(donde)
}

const MATRICULA = {
  id: 'm-1',
  nino_id: 'n-1',
  aula_id: 'a-1',
  curso_academico_id: 'c-1',
  estado: 'baja',
  activada_at: null,
  fecha_alta: '2026-09-01',
  fecha_baja: '2026-11-01',
  aulas_curso: {
    aulas: { nombre: 'Aula Demo' },
    cursos_academicos: { nombre: '26-27', fecha_inicio: '2026-09-01' },
  },
}

beforeEach(() => {
  estado.falla = null
  estado.leidas = []
  estado.filas = {
    ninos: [
      {
        id: 'n-1',
        nombre: 'Niño',
        apellidos: 'Demo',
        fecha_nacimiento: '2024-01-01',
        familia_id: 'f-1',
      },
    ],
    // Un recorrido posible: una matrícula cerrada (con su motivo) y la vigente, activada.
    matriculas: [
      MATRICULA,
      {
        ...MATRICULA,
        id: 'm-2',
        estado: 'activa',
        activada_at: '2026-11-02T09:00:00Z',
        fecha_alta: '2026-11-02',
        fecha_baja: null,
      },
    ],
    mandatos_sepa: {
      id: 'ms-1',
      estado: 'activo',
      titular: 'Tutora Demo',
      identificador_mandato: 'X',
      fecha_firma: '2026-09-01',
      documento_path: null,
    },
    consentimientos: { version: 'v1', aceptado_en: '2026-09-01' },
  }
  estado.rpcs = {
    get_motivos_baja_matriculas: [{ matricula_id: 'm-1', motivo_baja: 'Traslado' }],
    get_recorrido_nino_familia: [
      {
        matricula_id: 'm-1',
        aula_nombre: 'Aula Demo',
        curso_id: 'c-1',
        curso_nombre: '26-27',
        curso_fecha_inicio: '2026-09-01',
        fecha_alta: '2026-09-01',
        fecha_baja: null,
        estado: 'activa',
      },
    ],
  }
})

describe('la lista y la ficha del niño', () => {
  it('premisa: con todo leído, salen el aula, el motivo de baja y el recorrido', async () => {
    expect(JSON.stringify(await getNinosPorCentro('centro-1'))).toContain('Aula Demo')
    expect((await getMatriculasPorNino('n-1'))[0]?.motivo_baja).toBe('Traslado')
    expect(JSON.stringify(await getHistoricoMatriculas('n-1'))).toContain('Traslado')
    expect(await getRecorridoNinoFamilia('n-1')).toHaveLength(1)
  })

  it('la lista sin las matrículas: no sale vacía, lanza', async () => {
    estado.falla = 'matriculas'
    await lanzaEn(getNinosPorCentro('centro-1'), 'getNinosPorCentro: matrículas')
  })

  it.each([
    ['matriculas', 'getMatriculasPorNino'],
    ['get_motivos_baja_matriculas', 'motivos de baja'],
  ])('las matrículas de la ficha con %s caída: lanza en «%s»', async (caida, donde) => {
    estado.falla = caida
    await lanzaEn(getMatriculasPorNino('n-1'), donde)
  })

  it.each([
    ['matriculas', 'getHistoricoMatriculas'],
    ['get_motivos_baja_matriculas', 'motivos de baja'],
  ])('el histórico con %s caída: lanza en «%s»', async (caida, donde) => {
    estado.falla = caida
    await lanzaEn(getHistoricoMatriculas('n-1'), donde)
  })

  it('el recorrido de la familia sin leer: no dice «sin recorrido», lanza', async () => {
    estado.falla = 'get_recorrido_nino_familia'
    await lanzaEn(getRecorridoNinoFamilia('n-1'), 'getRecorridoNinoFamilia')
  })
})

describe('el resumen del alta para Dirección', () => {
  it('premisa: con todo leído, salen el mandato y el consentimiento médico', async () => {
    const r = await getAltaDocumentacion('n-1')
    expect(r.mandato?.titular).toBe('Tutora Demo')
    expect(r.consentimientoMedico?.version).toBe('v1')
  })

  it.each([
    ['ninos', 'getAltaDocumentacion: familia'],
    ['mandatos_sepa', 'getAltaDocumentacion: mandato'],
    ['consentimientos', 'getAltaDocumentacion: consentimiento médico'],
  ])('con %s caída: no dice «sin», lanza en «%s»', async (caida, donde) => {
    estado.falla = caida
    await lanzaEn(getAltaDocumentacion('n-1'), donde)
  })
})
