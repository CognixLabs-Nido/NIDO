import { describe, expect, it, vi } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { aplicarCambioPendiente, descartarCambioPendiente } from '../aplicar'

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
      nino_id: 'n1',
      payload: { tipo_vinculo: 'tutor_legal_principal', path: 'c/n/dni.pdf' },
    })
    expect(updates).toEqual([
      { table: 'familia_tutores', patch: { dni_documento_path: 'c/n/dni.pdf' } },
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
        nino_id: 'n1',
        payload: { tipo_vinculo: 'tutor_legal_principal', nombre_completo: 'Ana' },
      })
    ).rejects.toThrow(/familia_no_encontrada/)
  })

  it('lanza ante entidad desconocida', async () => {
    const service = mockService({})
    await expect(
      aplicarCambioPendiente(service, { entidad: 'otra_cosa', nino_id: 'n1', payload: {} })
    ).rejects.toThrow(/entidad_desconocida/)
  })

  it('lanza ante payload inválido (documento sin path)', async () => {
    const service = mockService({})
    await expect(
      aplicarCambioPendiente(service, {
        entidad: 'ninos_libro_familia',
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
      nino_id: 'n1',
      payload: { tipo_vinculo: 'tutor_legal_secundario', path: 'c/n/dni.pdf' },
    })
    expect(removed).toEqual([{ bucket: 'dni-tutores', paths: ['c/n/dni.pdf'] }])
  })

  it('no borra nada para un parche de datos (sin documento staged)', async () => {
    const removed: unknown[] = []
    const service = mockService({ storageRemove: () => removed.push(1) })
    await descartarCambioPendiente(service, {
      entidad: 'ninos_familia',
      nino_id: 'n1',
      payload: { direccion_calle: 'x' },
    })
    expect(removed).toHaveLength(0)
  })
})
