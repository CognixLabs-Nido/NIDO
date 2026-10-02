import { describe, expect, it, vi } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

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
    builder.maybeSingle = vi.fn(async () => ({
      data: opts.maybeSingleByTable?.[table] ?? opts.maybeSingleData ?? null,
      error: null,
    }))
    return builder
  }
  return {
    from: vi.fn((table: string) => makeBuilder(table)),
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

    await aplicarCambioPendiente(service, {
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
    await aplicarCambioPendiente(service, {
      entidad: 'ninos_familia',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { direccion_calle: undefined },
    })
    expect(updates).toHaveLength(0)
  })

  it('datos_tutor_dni: fija dni_documento_path en familia_tutores (perfil compartido)', async () => {
    const updates: Array<{ table: string; patch: Record<string, unknown> }> = []
    const service = mockService({
      maybeSingleByTable: {
        ninos: { familia_id: 'f1' },
        familia_tutores: { id: 'ft1', dni_documento_path: null },
      },
      onUpdate: (table, patch) => updates.push({ table, patch }),
    })
    await aplicarCambioPendiente(service, {
      entidad: 'datos_tutor_dni',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { tipo_vinculo: 'tutor_legal_principal', path: 'c1/n1/dni.pdf' },
    })
    expect(updates).toEqual([
      { table: 'familia_tutores', patch: { dni_documento_path: 'c1/n1/dni.pdf' } },
    ])
  })

  it('datos_tutor: actualiza identidad del titular en familia_tutores', async () => {
    const updates: Array<{ table: string; patch: Record<string, unknown> }> = []
    const service = mockService({
      maybeSingleByTable: {
        ninos: { familia_id: 'f1' },
        familia_tutores: { id: 'ft-titular' },
      },
      onUpdate: (table, patch) => updates.push({ table, patch }),
    })
    await aplicarCambioPendiente(service, {
      entidad: 'datos_tutor',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { tipo_vinculo: 'tutor_legal_principal', nombre_completo: 'Ana Pérez' },
    })
    expect(updates).toHaveLength(1)
    expect(updates[0]!.table).toBe('familia_tutores')
    expect(updates[0]!.patch).toMatchObject({ nombre_completo: 'Ana Pérez' })
  })

  it('datos_tutor: INSERTA el segundo_tutor si no hay fila viva (usuario_id NULL)', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
    const service = mockService({
      maybeSingleByTable: { ninos: { familia_id: 'f1' }, familia_tutores: null },
      onInsert: (table, row) => inserts.push({ table, row }),
    })
    await aplicarCambioPendiente(service, {
      entidad: 'datos_tutor',
      centro_id: 'c1',
      nino_id: 'n1',
      payload: { tipo_vinculo: 'tutor_legal_secundario', email: 'tutor2@correo.es' },
    })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]!.table).toBe('familia_tutores')
    expect(inserts[0]!.row).toMatchObject({
      familia_id: 'f1',
      rol_familia: 'segundo_tutor',
      usuario_id: null,
      email: 'tutor2@correo.es',
    })
  })

  it('datos_tutor: lanza si el niño no tiene familia (NOT NULL de F-2b-3)', async () => {
    const service = mockService({ maybeSingleByTable: { ninos: {} } })
    await expect(
      aplicarCambioPendiente(service, {
        entidad: 'datos_tutor',
        centro_id: 'c1',
        nino_id: 'n1',
        payload: { tipo_vinculo: 'tutor_legal_principal', nombre_completo: 'Ana' },
      })
    ).rejects.toThrow(/familia_no_encontrada/)
  })

  it('lanza ante entidad desconocida', async () => {
    const service = mockService({})
    await expect(
      aplicarCambioPendiente(service, {
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
      aplicarCambioPendiente(service, {
        entidad: 'ninos_libro_familia',
        centro_id: 'c1',
        nino_id: 'n1',
        payload: {},
      })
    ).rejects.toThrow()
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
      aplicarCambioPendiente(service, {
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
      aplicarCambioPendiente(service, {
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
    await aplicarCambioPendiente(service, {
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
