import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarRol,
  clientFor,
  crearVinculo,
  createTestCentro,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestNino,
  type TestUser,
} from './setup'

/**
 * La ficha médica, cifrada entera (`20261123120000`).
 *
 * Hasta ahora solo `alergias_graves` y `notas_emergencia` iban cifradas; los otros cuatro campos
 * se guardaban en claro en la tabla y, por el trigger de auditoría, en `audit_log`. Ahora los dos
 * setters cifran los seis, `get_info_medica_emergencia` descifra los seis y vacío = NULL (las
 * listas del aula pintan el aviso si la columna no es NULL).
 */

const CAMPOS = [
  'alergias_graves',
  'notas_emergencia',
  'medicacion_habitual',
  'alergias_leves',
  'medico_familia',
  'telefono_emergencia',
] as const
type Campo = (typeof CAMPOS)[number]
type Ficha = Record<Campo, string>

/** Los cuatro que antes iban en claro. */
const CUATRO = [
  'medicacion_habitual',
  'alergias_leves',
  'medico_familia',
  'telefono_emergencia',
] as const

function ficha(sufijo: string): Ficha {
  return {
    alergias_graves: `Alergia grave ficticia ${sufijo}`,
    notas_emergencia: `Nota ficticia ${sufijo}`,
    medicacion_habitual: `Medicación ficticia ${sufijo}`,
    alergias_leves: `Alergia leve ficticia ${sufijo}`,
    medico_familia: `Médico Demo ${sufijo}`,
    telefono_emergencia: `60000000${sufijo.length}`,
  }
}

function args(ninoId: string, f: Partial<Record<Campo, string | null>>) {
  return {
    p_nino_id: ninoId,
    p_alergias_graves: f.alergias_graves ?? null,
    p_notas_emergencia: f.notas_emergencia ?? null,
    p_medicacion_habitual: f.medicacion_habitual ?? null,
    p_alergias_leves: f.alergias_leves ?? null,
    p_medico_familia: f.medico_familia ?? null,
    p_telefono_emergencia: f.telefono_emergencia ?? null,
    // El tipo generado declara los args como no-nullable, pero la RPC acepta NULL
    // (contrato "NULL = preservar" del setter médico), como en la app.
  } as unknown as {
    p_nino_id: string
    p_alergias_graves: string
    p_notas_emergencia: string
    p_medicacion_habitual: string
    p_alergias_leves: string
    p_medico_familia: string
    p_telefono_emergencia: string
  }
}

const hex = (texto: string) => Buffer.from(texto, 'utf8').toString('hex')

/** Un bytea de PostgREST (`\x…`) que no lleva dentro el texto, ni en claro ni en hexadecimal. */
function cifrado(valor: unknown, texto: string) {
  expect(typeof valor).toBe('string')
  const v = valor as string
  expect(v.startsWith('\\x')).toBe(true)
  expect(v).not.toContain(hex(texto))
  expect(v).not.toContain(texto)
}

describe('La ficha médica, cifrada entera', () => {
  let centro: { id: string }
  let nino: TestNino
  let admin: TestUser
  let tutor: TestUser
  let cAdmin: SupabaseClient<Database>
  let cTutor: SupabaseClient<Database>

  async function cruda() {
    const { data, error } = await serviceClient
      .from('info_medica_emergencia')
      .select('id, ' + CAMPOS.join(', '))
      .eq('nino_id', nino.id)
      .single()
    if (error || !data) throw new Error(`fila médica: ${error?.message}`)
    return data as unknown as Record<Campo | 'id', string | null>
  }

  async function leida(cliente: SupabaseClient<Database>) {
    const { data, error } = await cliente.rpc('get_info_medica_emergencia', { p_nino_id: nino.id })
    expect(error).toBeNull()
    return data?.[0] ?? null
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Ficha Medica Cifrada')
    nino = await createTestNino(centro.id, 'Niño Demo Ficha Cifrada')
    admin = await createTestUser({ nombre: 'Admin Ficha Cifrada' })
    tutor = await createTestUser({ nombre: 'Tutor Ficha Cifrada' })
    await asignarRol(admin.id, centro.id, 'admin')
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
    cAdmin = await clientFor(admin)
    cTutor = await clientFor(tutor)
  }, 60_000)

  afterAll(async () => {
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(tutor.id)
  }, 60_000)

  it('Dirección: los seis se guardan cifrados y se leen descifrados', async () => {
    const f = ficha('a')
    const { error } = await cAdmin.rpc('set_info_medica_emergencia_cifrada', args(nino.id, f))
    expect(error).toBeNull()

    const fila = await cruda()
    for (const c of CAMPOS) cifrado(fila[c], f[c])
    expect(await leida(cAdmin)).toEqual(f)
  })

  it('la familia: los seis se guardan cifrados y se leen descifrados', async () => {
    const f = ficha('bb')
    const { error } = await cTutor.rpc('set_info_medica_emergencia_cifrada_tutor', {
      ...args(nino.id, f),
      p_reemplazar: true,
    })
    expect(error).toBeNull()

    const fila = await cruda()
    for (const c of CAMPOS) cifrado(fila[c], f[c])
    expect(await leida(cTutor)).toEqual(f)
  })

  it('NULL preserva: cambiar un campo no toca los otros cinco', async () => {
    const antes = await cruda()
    const { error } = await cAdmin.rpc(
      'set_info_medica_emergencia_cifrada',
      args(nino.id, { medico_familia: 'Médico Demo nuevo' })
    )
    expect(error).toBeNull()

    const despues = await cruda()
    for (const c of CAMPOS.filter((c) => c !== 'medico_familia')) expect(despues[c]).toBe(antes[c])
    expect((await leida(cAdmin))?.medico_familia).toBe('Médico Demo nuevo')
  })

  it('vacío = NULL: un texto vacío o solo espacios vacía el campo, en los dos setters', async () => {
    // Premisa: los dos campos tienen valor antes.
    const antes = await cruda()
    expect(antes.medicacion_habitual).not.toBeNull()
    expect(antes.alergias_leves).not.toBeNull()

    const tutorVacio = await cTutor.rpc('set_info_medica_emergencia_cifrada_tutor', {
      ...args(nino.id, { medicacion_habitual: '', alergias_leves: '   ' }),
      p_reemplazar: false,
    })
    expect(tutorVacio.error).toBeNull()
    let fila = await cruda()
    expect(fila.medicacion_habitual).toBeNull()
    expect(fila.alergias_leves).toBeNull()
    // Los que iban como NULL se preservan.
    expect(fila.medico_familia).toBe(antes.medico_familia)

    const adminVacio = await cAdmin.rpc(
      'set_info_medica_emergencia_cifrada',
      args(nino.id, { telefono_emergencia: '' })
    )
    expect(adminVacio.error).toBeNull()
    fila = await cruda()
    expect(fila.telefono_emergencia).toBeNull()
    expect(fila.medico_familia).toBe(antes.medico_familia)
  })

  it('audit_log: los cuatro campos solo entran cifrados', async () => {
    const { id } = await cruda()
    const { data, error } = await serviceClient
      .from('audit_log')
      .select('valores_antes, valores_despues')
      .eq('tabla', 'info_medica_emergencia')
      .eq('registro_id', id as string)
    expect(error).toBeNull()
    const copias = (data ?? []).flatMap((a) =>
      [a.valores_antes, a.valores_despues].filter(Boolean)
    ) as Array<Record<string, unknown>>

    // Premisa: la auditoría guardó la ficha, y cada uno de los cuatro aparece con valor alguna vez.
    expect(copias.length).toBeGreaterThan(0)
    for (const c of CUATRO) expect(copias.some((v) => v[c] != null)).toBe(true)

    const textos = [ficha('a'), ficha('bb')].flatMap((f) => CUATRO.map((c) => f[c]))
    textos.push('Médico Demo nuevo')
    for (const v of copias) {
      for (const c of CUATRO) {
        if (v[c] == null) continue
        expect(typeof v[c]).toBe('string')
        expect((v[c] as string).startsWith('\\x')).toBe(true)
        for (const t of textos) {
          expect(v[c] as string).not.toContain(t)
          expect(v[c] as string).not.toContain(hex(t))
        }
      }
    }
  })
})
