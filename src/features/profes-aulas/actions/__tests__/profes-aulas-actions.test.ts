import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { cambiarTipoPersonalCore } from '../cambiar-tipo-personal'
import { moverProfeAulaCore } from '../mover-profe-aula'
import { sustituirCoordinadoraCore } from '../sustituir-coordinadora'
import { terminarAsignacionCore } from '../terminar-asignacion'

/**
 * Tests unitarios de los núcleos de las 4 actions de personal (item 4).
 * Inyectamos un `SupabaseClient` falso con cola de respuestas: cada
 * sentencia `await`-eada del action consume la siguiente respuesta en
 * orden. `calls` registra los insert/update para verificar orden y patch.
 */

// UUIDs v4 válidos (version nibble = 4, variant = 8): zod 4 `.uuid()` es
// estricto con RFC y rechaza version/variant fuera de rango.
const ASIG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const ASIG2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const AULA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const AULA2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const PROFE = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'

interface Resp {
  data: unknown
  error: unknown
}
interface Call {
  op: 'insert' | 'update'
  patch: unknown
}

function makeFake(responses: Resp[]) {
  const calls: Call[] = []
  let i = 0
  const next = (): Resp => responses[i++] ?? { data: null, error: null }

  function builder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    b.select = () => b
    b.eq = () => b
    b.is = () => b
    b.in = () => b
    b.order = () => b
    b.single = () => b
    b.maybeSingle = () => b
    b.update = (patch: unknown) => {
      calls.push({ op: 'update', patch })
      return b
    }
    b.insert = (patch: unknown) => {
      calls.push({ op: 'insert', patch })
      return b
    }
    b.then = (resolve: (v: Resp) => unknown) => resolve(next())
    return b
  }

  const fake = { from: () => builder() } as unknown as SupabaseClient<Database>
  return { fake, calls }
}

describe('terminarAsignacionCore', () => {
  it('success: UPDATE fecha_fin y devuelve id', async () => {
    const { fake, calls } = makeFake([{ data: { id: ASIG }, error: null }])
    const r = await terminarAsignacionCore(fake, { asignacion_id: ASIG })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.id).toBe(ASIG)
    expect(calls[0]?.op).toBe('update')
    expect(calls[0]?.patch).toHaveProperty('fecha_fin')
  })

  it('0 filas (RLS/no encontrada): fail asignacion_no_encontrada', async () => {
    const { fake } = makeFake([{ data: null, error: null }])
    const r = await terminarAsignacionCore(fake, { asignacion_id: ASIG })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('profeAula.errors.asignacion_no_encontrada')
  })

  it('input inválido: fail de validación sin tocar BD', async () => {
    const { fake, calls } = makeFake([])
    const r = await terminarAsignacionCore(fake, { asignacion_id: 'no-uuid' })
    expect(r.success).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('cambiarTipoPersonalCore', () => {
  it('success cambia a tecnico', async () => {
    const { fake, calls } = makeFake([{ data: { id: ASIG }, error: null }])
    const r = await cambiarTipoPersonalCore(fake, {
      asignacion_id: ASIG,
      tipo_personal_aula: 'tecnico',
    })
    expect(r.success).toBe(true)
    expect(calls[0]?.patch).toMatchObject({ tipo_personal_aula: 'tecnico' })
  })

  it('23505 al promocionar a coordinadora: fail ya_principal', async () => {
    const { fake } = makeFake([{ data: null, error: { code: '23505', message: 'dup' } }])
    const r = await cambiarTipoPersonalCore(fake, {
      asignacion_id: ASIG,
      tipo_personal_aula: 'coordinadora',
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('profeAula.errors.ya_principal')
  })
})

describe('sustituirCoordinadoraCore', () => {
  it('con coordinadora actual: degrada primero, promociona después (orden seguro)', async () => {
    const { fake, calls } = makeFake([
      { data: { id: ASIG2 }, error: null }, // lookup coordinadora actual
      { data: null, error: null }, // degradar actual
      { data: { id: ASIG }, error: null }, // promover nueva
    ])
    const r = await sustituirCoordinadoraCore(fake, {
      aula_id: AULA,
      nueva_asignacion_id: ASIG,
    })
    expect(r.success).toBe(true)
    expect(calls).toHaveLength(2) // 2 updates (degradar + promover)
    expect(calls[0]?.patch).toMatchObject({ tipo_personal_aula: 'profesora' }) // degradar primero
    expect(calls[1]?.patch).toMatchObject({ tipo_personal_aula: 'coordinadora' }) // promover después
  })

  it('sin coordinadora actual: solo promociona', async () => {
    const { fake, calls } = makeFake([
      { data: null, error: null }, // lookup → no hay coordinadora
      { data: { id: ASIG }, error: null }, // promover
    ])
    const r = await sustituirCoordinadoraCore(fake, {
      aula_id: AULA,
      nueva_asignacion_id: ASIG,
    })
    expect(r.success).toBe(true)
    expect(calls).toHaveLength(1) // solo el promover
    expect(calls[0]?.patch).toMatchObject({ tipo_personal_aula: 'coordinadora' })
  })

  it('23505 de carrera al promocionar: fail ya_principal', async () => {
    const { fake } = makeFake([
      { data: null, error: null }, // sin coordinadora actual
      { data: null, error: { code: '23505', message: 'dup' } }, // promover choca
    ])
    const r = await sustituirCoordinadoraCore(fake, {
      aula_id: AULA,
      nueva_asignacion_id: ASIG,
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('profeAula.errors.ya_principal')
  })
})

describe('moverProfeAulaCore', () => {
  it('success: INSERT destino antes de cerrar origen (Nota D)', async () => {
    const { fake, calls } = makeFake([
      {
        data: { id: ASIG, profe_id: PROFE, aula_id: AULA, tipo_personal_aula: 'profesora' },
        error: null,
      }, // origen
      { data: null, error: null }, // no está en destino
      { data: { id: ASIG2 }, error: null }, // insert destino
      { data: null, error: null }, // cerrar origen
    ])
    const r = await moverProfeAulaCore(fake, {
      asignacion_id: ASIG,
      aula_destino_id: AULA2,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.id).toBe(ASIG2)
    expect(calls[0]?.op).toBe('insert') // INSERT destino primero
    expect(calls[1]?.op).toBe('update') // cerrar origen después
    expect(calls[1]?.patch).toHaveProperty('fecha_fin')
  })

  it('coordinadora se reinicia a profesora en destino', async () => {
    const { fake, calls } = makeFake([
      {
        data: { id: ASIG, profe_id: PROFE, aula_id: AULA, tipo_personal_aula: 'coordinadora' },
        error: null,
      },
      { data: null, error: null },
      { data: { id: ASIG2 }, error: null },
      { data: null, error: null },
    ])
    const r = await moverProfeAulaCore(fake, { asignacion_id: ASIG, aula_destino_id: AULA2 })
    expect(r.success).toBe(true)
    expect(calls[0]?.patch).toMatchObject({ tipo_personal_aula: 'profesora' })
  })

  it('ya activa en destino: aborta sin INSERT ni cerrar origen', async () => {
    const { fake, calls } = makeFake([
      {
        data: { id: ASIG, profe_id: PROFE, aula_id: AULA, tipo_personal_aula: 'profesora' },
        error: null,
      },
      { data: { id: 'existe' }, error: null }, // ya en destino
    ])
    const r = await moverProfeAulaCore(fake, { asignacion_id: ASIG, aula_destino_id: AULA2 })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('profeAula.errors.mover_ya_en_destino')
    expect(calls).toHaveLength(0) // no se tocó nada
  })

  it('mismo aula origen=destino: fail mover_mismo_aula', async () => {
    const { fake } = makeFake([
      {
        data: { id: ASIG, profe_id: PROFE, aula_id: AULA, tipo_personal_aula: 'profesora' },
        error: null,
      },
    ])
    const r = await moverProfeAulaCore(fake, { asignacion_id: ASIG, aula_destino_id: AULA })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('profeAula.errors.mover_mismo_aula')
  })

  it('INSERT destino falla: no cierra origen', async () => {
    const { fake, calls } = makeFake([
      {
        data: { id: ASIG, profe_id: PROFE, aula_id: AULA, tipo_personal_aula: 'profesora' },
        error: null,
      },
      { data: null, error: null },
      { data: null, error: { code: 'XX', message: 'insert fail' } }, // insert falla
    ])
    const r = await moverProfeAulaCore(fake, { asignacion_id: ASIG, aula_destino_id: AULA2 })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('profeAula.errors.mover_fallo')
    // Solo el insert se intentó; no hay update de cierre.
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(0)
  })
})
