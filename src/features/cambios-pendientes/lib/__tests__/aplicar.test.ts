import { describe, expect, it, vi } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'
import type { Database } from '@/types/db'

import { rutaDocumentoDelNino } from '../../schemas'
import {
  aplicarCambioPendiente,
  descartarCambioPendiente,
  RutaDocumentoInvalidaError,
} from '../aplicar'

/**
 * Mock mínimo de un query-builder de supabase-js: cada método encadenable devuelve
 * `this`; `maybeSingle` resuelve el valor preconfigurado. Registra las llamadas a
 * `from`/`update`/`insert` para verificar el despacho del dispatcher.
 */
function mockService(opts: {
  maybeSingleData?: unknown
  /** Dato de `maybeSingle` por tabla (p. ej. `ninos` → { familia_id }). */
  maybeSingleByTable?: Record<string, unknown>
  onUpdate?: (table: string, patch: Record<string, unknown>) => void
  onInsert?: (table: string, row: Record<string, unknown>) => void
  storageRemove?: (bucket: string, paths: string[]) => void
  /** Fase 6: las llamadas a `guardar_tutor` / `fijar_dni_tutor`, y la ruta de antes que devuelve esta. */
  onRpc?: (fn: string, args: Record<string, unknown>) => void
  dniPrevio?: string | null
  /** Fase 9: la ruta del justificante de antes que devuelve `declarar_gastos_gestion`. */
  justificantePrevio?: string | null
  /** Censo C: tablas cuya lectura (`maybeSingle`) falla. */
  caidas?: string[]
}) {
  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'in']) builder[m] = vi.fn(() => builder)
    builder.update = vi.fn((patch: Record<string, unknown>) => {
      opts.onUpdate?.(table, patch)
      return builder
    })
    builder.insert = vi.fn((row: Record<string, unknown>) => {
      opts.onInsert?.(table, row)
      return builder
    })
    builder.maybeSingle = vi.fn(async () =>
      opts.caidas?.includes(table)
        ? { data: null, error: { code: 'XX000', message: 'caída' } }
        : { data: opts.maybeSingleByTable?.[table] ?? opts.maybeSingleData ?? null, error: null }
    )
    return builder
  }
  return {
    from: vi.fn((table: string) => makeBuilder(table)),
    // El libro anterior es de gestión: sale por `ficha_gestion_ninos` (`20270115120000`). El falso
    // contesta con lo que el test pone para `ninos`.
    rpc: vi.fn(async (fn: string, args: { p_nino_ids: string[] }) => {
      if (fn === 'declarar_gastos_gestion') {
        opts.onRpc?.(fn, args as unknown as Record<string, unknown>)
        return { data: opts.justificantePrevio ?? null, error: null }
      }
      if (fn === 'guardar_tutor' || fn === 'fijar_dni_tutor') {
        opts.onRpc?.(fn, args as unknown as Record<string, unknown>)
        return { data: fn === 'fijar_dni_tutor' ? (opts.dniPrevio ?? null) : 'ft1', error: null }
      }
      if (fn !== 'ficha_gestion_ninos') throw new Error(`rpc no prevista: ${fn}`)
      const fila = opts.maybeSingleByTable?.ninos as Record<string, unknown> | undefined
      return { data: fila ? [{ nino_id: args.p_nino_ids[0], ...fila }] : [], error: null }
    }),
    storage: {
      from: vi.fn((bucket: string) => ({
        remove: vi.fn(async (paths: string[]) => {
          opts.storageRemove?.(bucket, paths)
          return { data: null, error: null }
        }),
      })),
    },
  } as unknown as SupabaseClient<Database>
}

describe('aplicarCambioPendiente', () => {
  it('ninos_familia: actualiza ninos solo con las claves definidas del parche', async () => {
    const updates: Array<{ table: string; patch: Record<string, unknown> }> = []
    const service = mockService({ onUpdate: (table, patch) => updates.push({ table, patch }) })

    await aplicarCambioPendiente(service, service, {
      entidad: 'ninos_familia',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { direccion_calle: 'Calle Falsa', estado_civil_familia: undefined },
    })

    expect(updates).toHaveLength(1)
    expect(updates[0]!.table).toBe('ninos')
    expect(updates[0]!.patch).toEqual({ direccion_calle: 'Calle Falsa' })
  })

  it('ninos_familia: no toca BD si el parche queda vacío tras filtrar undefined', async () => {
    const updates: unknown[] = []
    const service = mockService({ onUpdate: () => updates.push(1) })
    await aplicarCambioPendiente(service, service, {
      entidad: 'ninos_familia',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { direccion_calle: undefined },
    })
    expect(updates).toHaveLength(0)
  })

  // Fase 6 (`20270118120000`): la cola aplica por `fijar_dni_tutor` / `guardar_tutor` con la sesión de
  // la directora, no con UPDATE/INSERT sobre la tabla.
  it('datos_tutor_dni: fija la ruta por fijar_dni_tutor y borra el DNI anterior', async () => {
    const rpcs: Array<[string, Record<string, unknown>]> = []
    const updates: unknown[] = []
    const removes: Array<{ bucket: string; paths: string[] }> = []
    const service = mockService({
      maybeSingleByTable: { ninos: { familia_id: 'f1' } },
      onUpdate: (t, patch) => updates.push({ t, patch }),
      onRpc: (fn, args) => rpcs.push([fn, args]),
      dniPrevio: 'c1/n1/dni-viejo.pdf',
      storageRemove: (bucket, paths) => removes.push({ bucket, paths }),
    })
    await aplicarCambioPendiente(service, service, {
      entidad: 'datos_tutor_dni',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { tipo_vinculo: 'tutor_legal_principal', path: 'c1/n1/dni.pdf' },
    })
    expect(rpcs).toEqual([
      [
        'fijar_dni_tutor',
        { p_familia_id: 'f1', p_rol_familia: 'titular', p_path: 'c1/n1/dni.pdf' },
      ],
    ])
    expect(updates).toEqual([])
    expect(removes).toEqual([{ bucket: 'dni-tutores', paths: ['c1/n1/dni-viejo.pdf'] }])
  })

  it('datos_tutor: por guardar_tutor, solo con las claves que trae el payload', async () => {
    const rpcs: Array<[string, Record<string, unknown>]> = []
    const updates: unknown[] = []
    const service = mockService({
      maybeSingleByTable: { ninos: { familia_id: 'f1' } },
      onUpdate: (t, patch) => updates.push({ t, patch }),
      onRpc: (fn, args) => rpcs.push([fn, args]),
    })
    await aplicarCambioPendiente(service, service, {
      entidad: 'datos_tutor',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: {
        tipo_vinculo: 'tutor_legal_principal',
        nombre_completo: 'Ana Pérez',
        telefono: '+34600000001',
      },
    })
    expect(rpcs).toEqual([
      [
        'guardar_tutor',
        {
          p_familia_id: 'f1',
          p_rol_familia: 'titular',
          p_datos: { nombre_completo: 'Ana Pérez', telefono: '+34600000001' },
        },
      ],
    ])
    expect(updates).toEqual([])
  })

  it('datos_tutor del segundo tutor: guardar_tutor con su rol (la función crea la fila si no está)', async () => {
    const rpcs: Array<[string, Record<string, unknown>]> = []
    const inserts: unknown[] = []
    const service = mockService({
      maybeSingleByTable: { ninos: { familia_id: 'f1' } },
      onInsert: (t, row) => inserts.push({ t, row }),
      onRpc: (fn, args) => rpcs.push([fn, args]),
    })
    await aplicarCambioPendiente(service, service, {
      entidad: 'datos_tutor',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { tipo_vinculo: 'tutor_legal_secundario', email: 'tutor2@correo.es' },
    })
    expect(rpcs[0]![1]).toMatchObject({
      p_rol_familia: 'segundo_tutor',
      p_datos: { email: 'tutor2@correo.es' },
    })
    expect(inserts).toEqual([])
  })

  it('datos_tutor: lanza si el niño no tiene familia (NOT NULL de F-2b-3)', async () => {
    const service = mockService({ maybeSingleByTable: { ninos: {} } })
    await expect(
      aplicarCambioPendiente(service, service, {
        entidad: 'datos_tutor',
        centro_id: 'c1',
        nino_id: 'n1',
        payload: { tipo_vinculo: 'tutor_legal_principal', nombre_completo: 'Ana' },
      })
    ).rejects.toThrow(/familia_no_encontrada/)
  })

  // Censo C (B1, 2026-11-26): con la lectura caída lanzaba «familia_no_encontrada», un motivo falso en el
  // log. Ahora LecturaFallida. Premisa: el caso de arriba (sin familia → familia_no_encontrada).
  it('datos_tutor: con la lectura del niño caída, LecturaFallida y no «familia no encontrada»', async () => {
    const service = mockService({ caidas: ['ninos'] })
    const e = await aplicarCambioPendiente(service, service, {
      entidad: 'datos_tutor',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { tipo_vinculo: 'tutor_legal_principal', nombre_completo: 'Ana' },
    }).then(
      () => null,
      (err: unknown) => err
    )
    expect(esLecturaFallida(e), `esperaba una LecturaFallida, llegó ${String(e)}`).toBe(true)
  })

  it('lanza ante entidad desconocida', async () => {
    const service = mockService({})
    await expect(
      aplicarCambioPendiente(service, service, {
        entidad: 'otra_cosa',
        centro_id: 'c1',
        nino_id: 'n1',
        payload: {},
      })
    ).rejects.toThrow(/entidad_desconocida/)
  })

  it('lanza ante payload inválido (documento sin path)', async () => {
    const service = mockService({})
    await expect(
      aplicarCambioPendiente(service, service, {
        entidad: 'ninos_libro_familia',
        centro_id: 'c1',
        nino_id: 'n1',
        payload: {},
      })
    ).rejects.toThrow()
  })

  it('PR-D (D2): las escrituras de BD van por `db` (sesión) y el borrado de Storage por `storage`', async () => {
    const dbUpdates: Array<{ table: string; patch: Record<string, unknown> }> = []
    const dbRemoves: string[][] = []
    const storageRemoves: Array<{ bucket: string; paths: string[] }> = []
    const db = mockService({
      maybeSingleByTable: { ninos: { libro_familia_path: 'c1/n1/viejo.pdf' } },
      onUpdate: (table, patch) => dbUpdates.push({ table, patch }),
      storageRemove: (_b, paths) => dbRemoves.push(paths),
    })
    const storage = mockService({
      storageRemove: (bucket, paths) => storageRemoves.push({ bucket, paths }),
    })
    await aplicarCambioPendiente(db, storage, {
      entidad: 'ninos_libro_familia',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { path: 'c1/n1/nuevo.pdf' },
    })
    expect(dbUpdates).toEqual([
      { table: 'ninos', patch: { libro_familia_path: 'c1/n1/nuevo.pdf' } },
    ])
    expect(storage.from).not.toHaveBeenCalled()
    expect(dbRemoves).toEqual([])
    expect(storageRemoves).toEqual([{ bucket: 'libro-familia', paths: ['c1/n1/viejo.pdf'] }])
  })
})

describe('descartarCambioPendiente', () => {
  it('borra el objeto staged del DNI rechazado', async () => {
    const removed: Array<{ bucket: string; paths: string[] }> = []
    const service = mockService({
      storageRemove: (bucket, paths) => removed.push({ bucket, paths }),
    })
    await descartarCambioPendiente(service, {
      entidad: 'datos_tutor_dni',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { tipo_vinculo: 'tutor_legal_secundario', path: 'c1/n1/dni.pdf' },
    })
    expect(removed).toEqual([{ bucket: 'dni-tutores', paths: ['c1/n1/dni.pdf'] }])
  })

  it('no borra nada para un parche de datos (sin documento staged)', async () => {
    const removed: unknown[] = []
    const service = mockService({ storageRemove: () => removed.push(1) })
    await descartarCambioPendiente(service, {
      entidad: 'ninos_familia',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { direccion_calle: 'x' },
    })
    expect(removed).toHaveLength(0)
  })
})

/**
 * R1/R1b — la ruta del documento staged la pone el tutor en el payload. Antes nadie la
 * validaba: al rechazar se borraba con service role (R1) y al aprobar se escribía como puntero
 * (R1b), aunque fuera el libro de familia o el DNI de otra familia/centro.
 */
const RUTAS_AJENAS: Array<[string, string]> = [
  ['otro centro y otro niño', 'c2/n2/libro.pdf'],
  ['mismo centro, otro niño', 'c1/n2/libro.pdf'],
  ['escapa del prefijo con ..', 'c1/n1/../../c2/n2/libro.pdf'],
  ['subcarpeta bajo el niño', 'c1/n1/sub/libro.pdf'],
  ['no es un pdf', 'c1/n1/libro.png'],
  ['prefijo sin la barra final', 'c1/n1x/libro.pdf'],
]

describe('rutaDocumentoDelNino', () => {
  it('acepta las formas que construyen las rutas de subida legítimas', () => {
    expect(rutaDocumentoDelNino('c1/n1/3f2a-uuid.pdf', 'c1', 'n1')).toBe(true)
    expect(rutaDocumentoDelNino('c1/n1/dni-tutor_legal_principal-3f2a.pdf', 'c1', 'n1')).toBe(true)
  })

  it.each(RUTAS_AJENAS)('rechaza una ruta ajena: %s', (_caso, ruta) => {
    expect(rutaDocumentoDelNino(ruta, 'c1', 'n1')).toBe(false)
  })
})

describe('R1b — aplicar NO escribe una ruta ajena al niño', () => {
  it.each(RUTAS_AJENAS)('ninos_libro_familia, %s → lanza y no toca BD', async (_caso, ruta) => {
    const updates: unknown[] = []
    const removed: unknown[] = []
    const service = mockService({
      maybeSingleByTable: { ninos: { libro_familia_path: 'c1/n1/previo.pdf' } },
      onUpdate: () => updates.push(1),
      storageRemove: () => removed.push(1),
    })
    await expect(
      aplicarCambioPendiente(service, service, {
        entidad: 'ninos_libro_familia',
        centro_id: 'c1',
        nino_id: 'n1',
        payload: { path: ruta },
      })
    ).rejects.toBeInstanceOf(RutaDocumentoInvalidaError)
    expect(updates).toHaveLength(0)
    expect(removed).toHaveLength(0)
  })

  it('datos_tutor_dni con ruta ajena → lanza y no toca BD', async () => {
    const updates: unknown[] = []
    const service = mockService({
      maybeSingleByTable: { ninos: { familia_id: 'f1' } },
      onUpdate: () => updates.push(1),
      onInsert: () => updates.push(1),
    })
    await expect(
      aplicarCambioPendiente(service, service, {
        entidad: 'datos_tutor_dni',
        centro_id: 'c1',
        nino_id: 'n1',
        payload: { tipo_vinculo: 'tutor_legal_principal', path: 'c2/n2/dni.pdf' },
      })
    ).rejects.toBeInstanceOf(RutaDocumentoInvalidaError)
    expect(updates).toHaveLength(0)
  })

  it('ninos_libro_familia con ruta del niño → fija la ruta y borra el libro anterior', async () => {
    const updates: Array<{ table: string; patch: Record<string, unknown> }> = []
    const removed: Array<{ bucket: string; paths: string[] }> = []
    const service = mockService({
      maybeSingleByTable: { ninos: { libro_familia_path: 'c1/n1/previo.pdf' } },
      onUpdate: (table, patch) => updates.push({ table, patch }),
      storageRemove: (bucket, paths) => removed.push({ bucket, paths }),
    })
    await aplicarCambioPendiente(service, service, {
      entidad: 'ninos_libro_familia',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { path: 'c1/n1/nuevo.pdf' },
    })
    expect(updates).toEqual([{ table: 'ninos', patch: { libro_familia_path: 'c1/n1/nuevo.pdf' } }])
    expect(removed).toEqual([{ bucket: 'libro-familia', paths: ['c1/n1/previo.pdf'] }])
  })
})

describe('R1 — descartar NO borra una ruta ajena al niño', () => {
  it.each(RUTAS_AJENAS)('ninos_libro_familia, %s → no borra nada', async (_caso, ruta) => {
    const removed: unknown[] = []
    const service = mockService({ storageRemove: () => removed.push(1) })
    await descartarCambioPendiente(service, {
      entidad: 'ninos_libro_familia',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { path: ruta },
    })
    expect(removed).toHaveLength(0)
  })

  it('datos_tutor_dni con ruta ajena → no borra nada', async () => {
    const removed: unknown[] = []
    const service = mockService({ storageRemove: () => removed.push(1) })
    await descartarCambioPendiente(service, {
      entidad: 'datos_tutor_dni',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { tipo_vinculo: 'tutor_legal_principal', path: 'c2/n2/dni.pdf' },
    })
    expect(removed).toHaveLength(0)
  })

  it('ninos_libro_familia con ruta del niño → borra el objeto staged', async () => {
    const removed: Array<{ bucket: string; paths: string[] }> = []
    const service = mockService({
      storageRemove: (bucket, paths) => removed.push({ bucket, paths }),
    })
    await descartarCambioPendiente(service, {
      entidad: 'ninos_libro_familia',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { path: 'c1/n1/staged.pdf' },
    })
    expect(removed).toEqual([{ bucket: 'libro-familia', paths: ['c1/n1/staged.pdf'] }])
  })
})

/** Fase 9: los gastos de gestión después del alta, por la cola. */
describe('gastos_gestion en la cola', () => {
  const K = '11111111-2222-4333-8444-555555555555'
  const aplicar = (payload: unknown, opts: Parameters<typeof mockService>[0] = {}) => {
    const rpcs: Array<[string, Record<string, unknown>]> = []
    const removes: Array<{ bucket: string; paths: string[] }> = []
    const s = mockService({
      ...opts,
      onRpc: (fn, args) => rpcs.push([fn, args]),
      storageRemove: (bucket, paths) => removes.push({ bucket, paths }),
    })
    const r = aplicarCambioPendiente(s, s, {
      entidad: 'gastos_gestion',
      centro_id: 'c1',
      nino_id: 'n1',
      payload,
    })
    return { r, rpcs, removes }
  }

  it('con justificante: declara transferencia con la ruta y borra el justificante anterior', async () => {
    const { r, rpcs, removes } = aplicar(
      { curso_academico_id: K, forma: 'transferencia', path: 'c1/n1/justificante-x.png' },
      { justificantePrevio: 'c1/n1/justificante-viejo.pdf' }
    )
    await r
    expect(rpcs).toEqual([
      [
        'declarar_gastos_gestion',
        {
          p_nino_id: 'n1',
          p_curso_academico_id: K,
          p_forma: 'transferencia',
          p_justificante_path: 'c1/n1/justificante-x.png',
        },
      ],
    ])
    expect(removes).toEqual([
      { bucket: 'justificantes-gestion', paths: ['c1/n1/justificante-viejo.pdf'] },
    ])
  })

  it('efectivo: declara sin ruta (la base la quita) y no borra nada si no había', async () => {
    const { r, rpcs, removes } = aplicar({ curso_academico_id: K, forma: 'efectivo' })
    await r
    expect(rpcs).toEqual([
      [
        'declarar_gastos_gestion',
        { p_nino_id: 'n1', p_curso_academico_id: K, p_forma: 'efectivo' },
      ],
    ])
    expect(removes).toEqual([])
  })

  it.each([
    ['de otro niño', 'c1/n2/justificante.pdf'],
    ['de otro centro', 'c2/n1/justificante.pdf'],
    ['con un tipo que el bucket no admite', 'c1/n1/justificante.exe'],
  ])('ruta %s → lanza y no declara', async (_caso, path) => {
    const { r, rpcs } = aplicar({ curso_academico_id: K, forma: 'transferencia', path })
    await expect(r).rejects.toBeInstanceOf(RutaDocumentoInvalidaError)
    expect(rpcs).toEqual([])
  })

  it('justificante con efectivo no vale (el CHECK lo prohíbe): lanza y no declara', async () => {
    const { r, rpcs } = aplicar({
      curso_academico_id: K,
      forma: 'efectivo',
      path: 'c1/n1/justificante.pdf',
    })
    await expect(r).rejects.toThrow()
    expect(rpcs).toEqual([])
  })

  it('descartar borra el justificante que quedó subido; sin él, o ajeno, nada', async () => {
    const removed: Array<{ bucket: string; paths: string[] }> = []
    const s = mockService({ storageRemove: (bucket, paths) => removed.push({ bucket, paths }) })
    const fila = (payload: unknown) => ({
      entidad: 'gastos_gestion',
      centro_id: 'c1',
      nino_id: 'n1',
      payload,
    })
    await descartarCambioPendiente(
      s,
      fila({ curso_academico_id: K, forma: 'transferencia', path: 'c1/n1/justificante.heic' })
    )
    await descartarCambioPendiente(s, fila({ curso_academico_id: K, forma: 'efectivo' }))
    await descartarCambioPendiente(
      s,
      fila({ curso_academico_id: K, forma: 'transferencia', path: 'c1/n2/justificante.pdf' })
    )
    expect(removed).toEqual([
      { bucket: 'justificantes-gestion', paths: ['c1/n1/justificante.heic'] },
    ])
  })
})
