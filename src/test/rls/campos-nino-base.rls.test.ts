import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/db'

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
 * Campos del niño, la base (serie de altas, fase 5, 5a; `20270112120000`). Lo que tiene que aguantar,
 * con la sesión de cada uno contra la base del CI:
 *
 *  - los dos apellidos: los escribe quien los sabe, en dos casillas, y `apellidos` la deriva la base.
 *    Escribir `apellidos` es un error para todos, también para Dirección y el servicio (#507);
 *  - las reglas de cada campo nuevo, por la función de la tutora y por la escritura directa de
 *    Dirección (`ninos_admin_all`), que no pasa por la función;
 *  - la provincia entra con la dirección; el prospecto, con sus dos apellidos, y el niño que sale de
 *    él los conserva sin partir nada;
 *  - la purga los borra todos, también sus copias en `audit_log`.
 *
 * Fixtures ficticios, del 2026-11-07.
 */
describe('Campos del niño, la base (5a)', () => {
  let centro: TestCentro
  let admin: TestUser
  let madre: TestUser
  let lucia: string
  let aula: string
  let curso: string
  let sesionMadre: Cliente
  let sesionAdmin: Cliente

  // La firma nueva: los dos apellidos no tienen DEFAULT y van siempre en pareja (NULL = no tocar).
  // El resto de la identidad, NULL: no se toca.
  const identidad = (over: Partial<Record<keyof Identidad, unknown>>) =>
    sesionMadre.rpc('actualizar_identidad_nino_tutor', {
      p_nino_id: lucia,
      p_primer_apellido: null,
      p_segundo_apellido: null,
      p_fecha_nacimiento: null,
      p_sexo: null,
      p_nacionalidad: null,
      p_idioma_principal: null,
      ...over,
    } as unknown as Identidad)
  const ficha = async () => {
    const { data, error } = await serviceClient
      .from('ninos')
      .select(
        'primer_apellido, segundo_apellido, apellidos, lugar_nacimiento, dni, hermanos_total, hermanos_lugar, direccion_provincia, observaciones_familia, como_nos_conocio, como_nos_conocio_otro'
      )
      .eq('id', lucia)
      .single()
    if (error) throw new Error(error.message)
    return data
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Campos 5a')
    curso = (await createTestCurso(centro.id, 'activo')).id
    aula = (await createTestAula(centro.id, curso)).id
    admin = await createTestUser({ nombre: 'Admin Campos' })
    madre = await createTestUser({ nombre: 'Madre Campos' })
    await asignarRol(admin.id, centro.id, 'admin')
    lucia = (await createTestNino(centro.id, 'Lucía')).id
    const matricula = await matricular(lucia, aula, curso)
    // El alta en curso: es cuando la familia rellena estos campos (con el alta validada, la
    // dirección va a la cola, `actualizar_familia_nino`).
    const pendiente = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('id', matricula)
    if (pendiente.error) throw new Error(pendiente.error.message)
    await crearVinculo(lucia, madre.id, 'tutor_legal_principal')
    sesionMadre = await clientFor(madre)
    sesionAdmin = await clientFor(admin)
  })

  afterAll(async () => {
    if (centro) await deleteTestCentro(centro.id)
    for (const u of [admin, madre]) if (u) await deleteTestUser(u.id)
  })

  it('premisa: Lucía, con el alta en curso, tiene un apellido (el del fixture) sin segundo, y la madre es su tutora legal', async () => {
    const { data: m } = await serviceClient
      .from('matriculas')
      .select('estado')
      .eq('nino_id', lucia)
      .single()
    expect(m?.estado).toBe('pendiente')
    const f = await ficha()
    expect(f.primer_apellido).not.toBeNull()
    expect(f.segundo_apellido).toBeNull()
    expect(f.apellidos).toBe(f.primer_apellido)
    const { data } = await sesionMadre.rpc('es_tutor_legal_de', { p_nino_id: lucia })
    expect(data).toBe(true)
  })

  it('la tutora escribe los dos apellidos, y `apellidos` la compone la base', async () => {
    const { error } = await identidad({
      p_primer_apellido: 'de la Fuente',
      p_segundo_apellido: 'Martín',
    })
    expect(error).toBeNull()
    expect(await ficha()).toMatchObject({
      primer_apellido: 'de la Fuente',
      segundo_apellido: 'Martín',
      apellidos: 'de la Fuente Martín',
    })
  })

  it('vacío quita el segundo apellido; sin el primero, el segundo no llega solo', async () => {
    expect(
      (await identidad({ p_primer_apellido: 'de la Fuente', p_segundo_apellido: '' })).error
    ).toBeNull()
    expect(await ficha()).toMatchObject({ segundo_apellido: null, apellidos: 'de la Fuente' })
    const solo = await identidad({ p_segundo_apellido: 'Martín' })
    expect(solo.error).toMatchObject({ code: '22023', hint: 'apellidos_en_pareja' })
    const vacio = await identidad({ p_primer_apellido: '  ', p_segundo_apellido: 'Martín' })
    expect(vacio.error).toMatchObject({ code: '22023', hint: 'primer_apellido' })
    expect((await ficha()).apellidos).toBe('de la Fuente')
  })

  it('`apellidos` no la escribe nadie: ni Dirección ni el servicio (#507)', async () => {
    // Premisa: Dirección sí escribe la ficha directamente (`ninos_admin_all`).
    const control = await sesionAdmin
      .from('ninos')
      .update({ lugar_nacimiento: 'Paterna' })
      .eq('id', lucia)
      .select('id')
    expect(control.error).toBeNull()
    expect(control.data).toHaveLength(1)
    for (const c of [sesionAdmin, serviceClient]) {
      const { error } = await c
        .from('ninos')
        .update({ apellidos: 'Otro' } as unknown as Database['public']['Tables']['ninos']['Update'])
        .eq('id', lucia)
      expect.soft(error?.code).toBe('428C9')
    }
    expect((await ficha()).apellidos).toBe('de la Fuente')
  })

  it('el DNI: se guarda limpio y con la letra comprobada; el NIE también', async () => {
    expect((await identidad({ p_dni: '12.345.678-z' })).error).toBeNull()
    expect((await ficha()).dni).toBe('12345678Z')
    expect((await identidad({ p_dni: '12345678A' })).error?.code).toBe('23514')
    expect((await identidad({ p_dni: 'x1234567l' })).error).toBeNull()
    expect((await ficha()).dni).toBe('X1234567L')
    // Directa, la de Dirección: la misma regla, porque es un CHECK.
    const directa = await sesionAdmin.from('ninos').update({ dni: '12345678A' }).eq('id', lucia)
    expect(directa.error?.code).toBe('23514')
  })

  it('los hermanos: el total cuenta al niño y el lugar va de 1 (el mayor) al total, siempre juntos', async () => {
    expect((await identidad({ p_hermanos_total: 3, p_hermanos_lugar: 2 })).error).toBeNull()
    expect(await ficha()).toMatchObject({ hermanos_total: 3, hermanos_lugar: 2 })
    expect((await identidad({ p_hermanos_total: 3, p_hermanos_lugar: 4 })).error?.code).toBe(
      '23514'
    )
    expect((await identidad({ p_hermanos_total: 3 })).error).toMatchObject({
      code: '22023',
      hint: 'hermanos',
    })
    // Directa: un CHECK que diera NULL dejaría pasar la mitad de la pareja (medido en el ensayo).
    const mitad = await sesionAdmin.from('ninos').update({ hermanos_lugar: null }).eq('id', lucia)
    expect(mitad.error?.code).toBe('23514')
    expect(await ficha()).toMatchObject({ hermanos_total: 3, hermanos_lugar: 2 })
  })

  it('cómo nos conoció: de la lista; «otro» con su texto, y el texto solo con «otro»', async () => {
    expect(
      (await identidad({ p_como_nos_conocio: 'otro', p_como_nos_conocio_otro: 'Feria del barrio' }))
        .error
    ).toBeNull()
    expect(await ficha()).toMatchObject({
      como_nos_conocio: 'otro',
      como_nos_conocio_otro: 'Feria del barrio',
    })
    expect(
      (await identidad({ p_como_nos_conocio: 'internet', p_como_nos_conocio_otro: 'se ignora' }))
        .error
    ).toBeNull()
    expect(await ficha()).toMatchObject({
      como_nos_conocio: 'internet',
      como_nos_conocio_otro: null,
    })
    expect((await identidad({ p_como_nos_conocio: 'otro' })).error?.code).toBe('23514')
    expect((await identidad({ p_como_nos_conocio: 'television' })).error?.code).toBe('23514')
    const directa = await sesionAdmin
      .from('ninos')
      .update({ como_nos_conocio: 'otro' })
      .eq('id', lucia)
    expect(directa.error?.code).toBe('23514')
  })

  it('NULL deja lo que hay y vacío lo borra (observaciones, lugar)', async () => {
    expect(
      (await identidad({ p_observaciones_familia: 'Los martes la recoge la abuela' })).error
    ).toBeNull()
    expect((await identidad({})).error).toBeNull()
    expect(await ficha()).toMatchObject({
      observaciones_familia: 'Los martes la recoge la abuela',
      lugar_nacimiento: 'Paterna',
    })
    expect(
      (await identidad({ p_observaciones_familia: '', p_lugar_nacimiento: '' })).error
    ).toBeNull()
    expect(await ficha()).toMatchObject({ observaciones_familia: null, lugar_nacimiento: null })
  })

  it('la provincia entra con la dirección (actualizar_familia_nino)', async () => {
    const { error } = await sesionMadre.rpc('actualizar_familia_nino', {
      p_nino_id: lucia,
      p_patch: { direccion_ciudad: 'Paterna', direccion_provincia: 'Valencia' },
    })
    expect(error).toBeNull()
    expect((await ficha()).direccion_provincia).toBe('Valencia')
  })

  it('el prospecto lleva sus dos apellidos; `apellidos_nino` la compone la base y no se escribe', async () => {
    const { data: p, error } = await sesionAdmin
      .from('lista_espera')
      .insert({
        centro_id: centro.id,
        curso_academico_id: curso,
        nombre_nino: 'Pablo',
        primer_apellido_nino: 'de la Fuente',
        segundo_apellido_nino: 'Martín',
        posicion: 1,
      })
      .select('id, apellidos_nino')
      .single()
    expect(error).toBeNull()
    expect(p?.apellidos_nino).toBe('de la Fuente Martín')
    const escrito = await sesionAdmin
      .from('lista_espera')
      .update({
        apellidos_nino: 'Otro',
      } as unknown as Database['public']['Tables']['lista_espera']['Update'])
      .eq('id', p!.id)
    expect(escrito.error?.code).toBe('428C9')
  })

  it('el niño que sale del prospecto conserva los dos apellidos, tal cual (crear_o_anadir_a_familia)', async () => {
    const { data, error } = await sesionAdmin.rpc('crear_o_anadir_a_familia', {
      p_nombre_nino: 'Pablo',
      p_primer_apellido_nino: 'de la Fuente',
      p_segundo_apellido_nino: 'Martín',
      p_fecha_nacimiento: '2025-03-01',
      p_centro_id: centro.id,
      p_aula_id: aula,
      p_tutor_email: `campos-5a-${centro.id.slice(0, 8)}@ejemplo.invalid`,
      p_tutor_nombre_completo: 'Tutora Campos',
      p_parentesco: 'madre',
      p_descripcion_parentesco: '',
      p_usuario_id: null as unknown as string,
      p_permisos:
        null as unknown as Database['public']['Functions']['crear_o_anadir_a_familia']['Args']['p_permisos'],
    })
    expect(error).toBeNull()
    const nino = (data as { nino_id: string }).nino_id
    const { data: fila } = await serviceClient
      .from('ninos')
      .select('primer_apellido, segundo_apellido, apellidos')
      .eq('id', nino)
      .single()
    expect(fila).toEqual({
      primer_apellido: 'de la Fuente',
      segundo_apellido: 'Martín',
      apellidos: 'de la Fuente Martín',
    })
  })

  it('la purga los borra todos, también sus copias en audit_log', async () => {
    // Premisa: hay datos nuevos en la ficha y copias suyas en audit_log, que la purga puede no limpiar.
    expect(
      (
        await identidad({
          p_primer_apellido: 'de la Fuente',
          p_segundo_apellido: 'Martín',
          p_dni: '12345678Z',
          p_observaciones_familia: 'Marca5a observación',
        })
      ).error
    ).toBeNull()
    const copias = (sql: string) =>
      Number(
        comoPostgres(
          `SELECT count(*) FROM public.audit_log WHERE tabla = 'ninos' AND registro_id = '${lucia}' AND (${sql})`
        )
      )
    const conDatos = `valores_antes::text LIKE '%12345678Z%' OR valores_despues::text LIKE '%12345678Z%' OR valores_antes::text LIKE '%Marca5a%' OR valores_despues::text LIKE '%Marca5a%' OR valores_despues::text LIKE '%Martín%' OR valores_antes::text LIKE '%Martín%'`
    expect(copias(conDatos)).toBeGreaterThan(0)
    comoPostgres(`SELECT privado.purgar_nino('${lucia}')`)
    expect(await ficha()).toEqual({
      primer_apellido: '[borrado]',
      segundo_apellido: null,
      apellidos: '[borrado]',
      lugar_nacimiento: null,
      dni: null,
      hermanos_total: null,
      hermanos_lugar: null,
      direccion_provincia: null,
      observaciones_familia: null,
      como_nos_conocio: null,
      como_nos_conocio_otro: null,
    })
    expect(copias(conDatos)).toBe(0)
  })
})
