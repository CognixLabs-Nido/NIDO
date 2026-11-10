import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { comoPostgres } from './documentos-centro-fixture'
import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'

type Cliente = SupabaseClient<Database>
type Identidad = Database['public']['Functions']['actualizar_identidad_nino_tutor']['Args']

/**
 * La puerta de identidad (`20270113120000`, 2026-11-08). Con el alta validada, la tutora legal no
 * cambia por la función los ocho campos que identifican al niño (nombre, apellidos, fecha y lugar
 * de nacimiento, sexo, nacionalidad, DNI): 42501 con HINT `cola_validacion`, y el cambio va a la
 * cola de Dirección. Mandar el mismo valor no es un cambio. El idioma y los hermanos siguen
 * directos; un niño sin el alta validada, todo directo; la Dirección escribe la ficha directamente
 * (es lo que hace al aprobar). La entrada de la cola lleva el DNI: la auditoría no copia el payload
 * y la purga del niño la borra.
 *
 * Lucía tiene los ocho campos con valor: así «mandar el mismo valor» se mide en los ocho, no solo en
 * los que tienen algo. Fixtures ficticios, del 2026-11-10.
 */
describe('La puerta de identidad del niño', () => {
  let centro: TestCentro
  let admin: TestUser
  let madre: TestUser
  let lucia: string // alta validada, los ocho campos con valor
  let pablo: string // alta en curso
  let ana: string // alta validada, para la cola y la purga
  let sesionMadre: Cliente
  let sesionAdmin: Cliente

  const IDENTIDAD = {
    nombre: 'Lucía',
    primer_apellido: 'García',
    segundo_apellido: 'López',
    fecha_nacimiento: '2024-03-15',
    sexo: 'F' as const,
    nacionalidad: 'española',
    lugar_nacimiento: 'Valencia',
    dni: '12345678Z',
  }

  const identidad = (nino: string, over: Partial<Record<keyof Identidad, unknown>>) =>
    sesionMadre.rpc('actualizar_identidad_nino_tutor', {
      p_nino_id: nino,
      p_primer_apellido: null,
      p_segundo_apellido: null,
      p_fecha_nacimiento: null,
      p_sexo: null,
      p_nacionalidad: null,
      p_idioma_principal: null,
      ...over,
    } as unknown as Identidad)

  const ficha = async (nino: string) => {
    const { data, error } = await serviceClient
      .from('ninos')
      .select(
        'nombre, primer_apellido, segundo_apellido, fecha_nacimiento, sexo, nacionalidad, lugar_nacimiento, dni, idioma_principal, hermanos_total, hermanos_lugar'
      )
      .eq('id', nino)
      .single()
    if (error) throw new Error(error.message)
    return data
  }

  const estadoMatricula = async (nino: string) => {
    const { data } = await serviceClient
      .from('matriculas')
      .select('estado')
      .eq('nino_id', nino)
      .single()
    return data?.estado
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Puerta Identidad')
    const curso = (await createTestCurso(centro.id, 'activo')).id
    const aula = (await createTestAula(centro.id, curso)).id
    admin = await createTestUser({ nombre: 'Admin Puerta' })
    madre = await createTestUser({ nombre: 'Madre Puerta' })
    await asignarRol(admin.id, centro.id, 'admin')
    lucia = (await createTestNino(centro.id, 'Lucía')).id
    pablo = (await createTestNino(centro.id, 'Pablo')).id
    ana = (await createTestNino(centro.id, 'Ana')).id
    for (const n of [lucia, pablo, ana]) {
      await matricular(n, aula, curso) // `activa`: el alta validada
      await crearVinculo(n, madre.id, 'tutor_legal_principal')
    }
    const p = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('nino_id', pablo)
    if (p.error) throw new Error(p.error.message)
    for (const n of [lucia, ana]) {
      const u = await serviceClient.from('ninos').update(IDENTIDAD).eq('id', n)
      if (u.error) throw new Error(u.error.message)
    }
    sesionMadre = await clientFor(madre)
    sesionAdmin = await clientFor(admin)
  })

  afterAll(async () => {
    if (centro) await deleteTestCentro(centro.id)
    for (const u of [admin, madre]) if (u) await deleteTestUser(u.id)
  })

  it('premisa: Lucía y Ana validadas con los ocho campos, Pablo en curso, la madre es tutora legal de los tres', async () => {
    expect(await estadoMatricula(lucia)).toBe('activa')
    expect(await estadoMatricula(ana)).toBe('activa')
    expect(await estadoMatricula(pablo)).toBe('pendiente')
    expect(await ficha(lucia)).toMatchObject(IDENTIDAD)
    for (const n of [lucia, pablo, ana]) {
      const { data } = await sesionMadre.rpc('es_tutor_legal_de', { p_nino_id: n })
      expect(data).toBe(true)
    }
  })

  it('con el alta validada, cada uno de los ocho, cambiado solo, va a la cola (42501, cola_validacion) y no se escribe', async () => {
    const cambios: [string, Partial<Record<keyof Identidad, unknown>>][] = [
      ['nombre', { p_nombre: 'Lucia' }],
      ['primer apellido', { p_primer_apellido: 'Garcia', p_segundo_apellido: 'López' }],
      ['segundo apellido', { p_primer_apellido: 'García', p_segundo_apellido: 'Lopez' }],
      ['fecha de nacimiento', { p_fecha_nacimiento: '2024-03-16' }],
      ['sexo', { p_sexo: 'X' }],
      ['nacionalidad', { p_nacionalidad: 'italiana' }],
      ['lugar de nacimiento', { p_lugar_nacimiento: 'Alzira' }],
      ['DNI', { p_dni: 'X1234567L' }],
    ]
    for (const [campo, over] of cambios) {
      const { error } = await identidad(lucia, over)
      expect.soft(error?.code, campo).toBe('42501')
      expect.soft(error?.hint, campo).toBe('cola_validacion')
    }
    expect(await ficha(lucia)).toMatchObject(IDENTIDAD)
  })

  it('mandar los ocho tal cual están no es un cambio: pasa', async () => {
    const { error } = await identidad(lucia, {
      p_nombre: IDENTIDAD.nombre,
      p_primer_apellido: IDENTIDAD.primer_apellido,
      p_segundo_apellido: IDENTIDAD.segundo_apellido,
      p_fecha_nacimiento: IDENTIDAD.fecha_nacimiento,
      p_sexo: IDENTIDAD.sexo,
      p_nacionalidad: IDENTIDAD.nacionalidad,
      p_lugar_nacimiento: IDENTIDAD.lugar_nacimiento,
      p_dni: IDENTIDAD.dni,
    })
    expect(error).toBeNull()
    expect(await ficha(lucia)).toMatchObject(IDENTIDAD)
  })

  it('el mismo DNI escrito de otra forma tampoco es un cambio', async () => {
    const { error } = await identidad(lucia, { p_dni: ' 12.345.678-z ' })
    expect(error).toBeNull()
    expect((await ficha(lucia)).dni).toBe(IDENTIDAD.dni)
  })

  it('el idioma y los hermanos siguen directos con el alta validada', async () => {
    const { error } = await identidad(lucia, {
      p_idioma_principal: 'va',
      p_hermanos_total: 3,
      p_hermanos_lugar: 2,
    })
    expect(error).toBeNull()
    expect(await ficha(lucia)).toMatchObject({
      ...IDENTIDAD,
      idioma_principal: 'va',
      hermanos_total: 3,
      hermanos_lugar: 2,
    })
  })

  it('sin el alta validada, la identidad sigue directa', async () => {
    const { error } = await identidad(pablo, {
      p_primer_apellido: 'Martín',
      p_segundo_apellido: '',
    })
    expect(error).toBeNull()
    expect((await ficha(pablo)).primer_apellido).toBe('Martín')
  })

  it('la Dirección escribe la identidad directamente (lo que hace al aprobar la cola)', async () => {
    const { data, error } = await sesionAdmin
      .from('ninos')
      .update({ dni: 'X1234567L' })
      .eq('id', lucia)
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBe(lucia)
    expect((await ficha(lucia)).dni).toBe('X1234567L')
    const r = await serviceClient.from('ninos').update({ dni: IDENTIDAD.dni }).eq('id', lucia)
    expect(r.error).toBeNull()
  })

  it('la entrada de identidad en la cola lleva el DNI; la auditoría no copia el payload y la purga la borra', async () => {
    const { data: entrada, error } = await sesionMadre
      .from('cambios_pendientes')
      .insert({
        centro_id: centro.id,
        nino_id: ana,
        entidad: 'ninos_identidad',
        registro_id: ana,
        payload: { dni: '87654321X' },
        solicitado_por: madre.id,
      })
      .select('id')
      .single()
    expect(error).toBeNull()

    // Premisa: la entrada existe y lleva el DNI.
    const { data: antes } = await serviceClient
      .from('cambios_pendientes')
      .select('id, payload')
      .eq('nino_id', ana)
    expect(antes).toHaveLength(1)
    expect(JSON.stringify(antes)).toContain('87654321X')

    // Su copia en audit_log existe, sin payload ni el DNI.
    const { data: copias } = await serviceClient
      .from('audit_log')
      .select('valores_despues')
      .eq('tabla', 'cambios_pendientes')
      .eq('registro_id', entrada!.id)
    expect(copias?.length).toBeGreaterThan(0)
    for (const c of copias ?? []) {
      expect(c.valores_despues).not.toHaveProperty('payload')
      expect(JSON.stringify(c.valores_despues)).not.toContain('87654321X')
    }

    comoPostgres(`SELECT privado.purgar_nino('${ana}')`)
    const { data: despues } = await serviceClient
      .from('cambios_pendientes')
      .select('id')
      .eq('nino_id', ana)
    expect(despues).toHaveLength(0)
  })
})
