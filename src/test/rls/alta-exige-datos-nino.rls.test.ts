import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { esFamiliaNuevaEnCentro } from '@/features/alta/queries/familia-nueva-en-centro'
import type { Database } from '@/types/db'

import {
  asignarRol,
  clientFor,
  completarDatosAlta,
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

/**
 * Fase 5b (`20270114120000`, 2026-11-11). Dos cosas, medidas también abiertas en producción en un
 * ensayo terminado en RAISE (sonda y ensayo LF y CRLF):
 *
 * 1. **El alta exige los datos del niño en la base.** `marcar_matricula_lista`, con la matrícula
 *    pendiente, frena (P0001, HINT `datos_nino_por_completar`) si falta el lugar de nacimiento, la
 *    nacionalidad o los hermanos, o los apellidos o la fecha (que hasta la 5b frenaban en silencio).
 *    No es retroactivo: el niño ya validado no se toca.
 * 2. **La Dirección rellena la ficha con su sesión.** En el alta en papel no puede usar la función de
 *    la tutora (`es_tutor_legal_de`, 42501): escribe directamente (`ninos_admin_all`), con los mismos
 *    CHECK, y así puede cerrar. La tutora y el autorizado no tienen ese camino: la RLS no les deja
 *    escribir la tabla (0 filas, sin error), y la ficha no cambia.
 *
 * Fixtures ficticios.
 */
describe('El alta exige los datos del niño (5b)', () => {
  let centro: TestCentro
  let admin: TestUser
  let madre: TestUser
  let tio: TestUser
  let pablo: string // alta en curso, sin los tres datos nuevos
  let carla: string // alta en curso, completa: a ella se le quita uno cada vez
  let ana: string // alta validada, sin los tres datos nuevos
  let sesion: Record<'admin' | 'madre' | 'tio', Cliente>

  const LOS_TRES = {
    lugar_nacimiento: null,
    nacionalidad: null,
    hermanos_total: null,
    hermanos_lugar: null,
  }

  const estado = async (nino: string) =>
    (await serviceClient.from('matriculas').select('estado').eq('nino_id', nino).single()).data
      ?.estado
  const ficha = async (nino: string) =>
    (
      await serviceClient
        .from('ninos')
        .select(
          'apellidos, fecha_nacimiento, lugar_nacimiento, nacionalidad, hermanos_total, hermanos_lugar'
        )
        .eq('id', nino)
        .single()
    ).data
  const cierra = (quien: keyof typeof sesion, nino: string) =>
    sesion[quien].rpc('marcar_matricula_lista', { p_nino_id: nino })
  const acuse = async (u: TestUser, nino: string) => {
    const { error } = await serviceClient.from('consentimientos').insert({
      usuario_id: u.id,
      tipo: 'datos_medicos',
      version: 'v2.0',
      metodo_firma: 'digital',
      nino_id: nino,
    })
    if (error) throw new Error(`acuse médico: ${error.message}`)
  }
  const aPendiente = async (nino: string) => {
    const { error } = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('nino_id', nino)
    if (error) throw new Error(error.message)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Exige Datos Niño')
    const curso = (await createTestCurso(centro.id, 'activo')).id
    const aula = (await createTestAula(centro.id, curso)).id
    admin = await createTestUser({ nombre: 'Admin Datos Niño' })
    madre = await createTestUser({ nombre: 'Madre Datos Niño' })
    tio = await createTestUser({ nombre: 'Tío Datos Niño' })
    await asignarRol(admin.id, centro.id, 'admin')
    pablo = (await createTestNino(centro.id, 'Pablo')).id
    carla = (await createTestNino(centro.id, 'Carla')).id
    ana = (await createTestNino(centro.id, 'Ana')).id
    for (const n of [pablo, carla, ana]) {
      await matricular(n, aula, curso)
      await crearVinculo(n, madre.id, 'tutor_legal_principal')
      await crearVinculo(n, tio.id, 'autorizado')
      await acuse(madre, n)
    }
    await acuse(admin, pablo)
    await aPendiente(pablo)
    await aPendiente(carla)
    await completarDatosAlta(carla)
    sesion = {
      admin: await clientFor(admin),
      madre: await clientFor(madre),
      tio: await clientFor(tio),
    }
  }, 90_000)

  afterAll(async () => {
    if (centro) await deleteTestCentro(centro.id)
    for (const u of [admin, madre, tio]) if (u) await deleteTestUser(u.id)
  })

  it('premisa: Pablo y Carla en curso, Ana validada; a Pablo y a Ana les faltan los tres, Carla los tiene', async () => {
    expect(await estado(pablo)).toBe('pendiente')
    expect(await estado(carla)).toBe('pendiente')
    expect(await estado(ana)).toBe('activa')
    expect(await ficha(pablo)).toMatchObject({ ...LOS_TRES, apellidos: 'Apellido Test' })
    expect(await ficha(ana)).toMatchObject(LOS_TRES)
    expect(await ficha(carla)).toMatchObject({ lugar_nacimiento: 'Lugar Demo', hermanos_total: 1 })
  })

  it('a Pablo no lo cierra nadie: la tutora y la Dirección reciben datos_nino_por_completar', async () => {
    for (const quien of ['madre', 'admin'] as const) {
      const { data, error } = await cierra(quien, pablo)
      expect.soft(error?.hint, quien).toBe('datos_nino_por_completar')
      expect.soft(data, quien).toBeNull()
    }
    expect(await estado(pablo)).toBe('pendiente')
  })

  it('a Carla le falta cada uno, quitado solo: frena; completa, cierra', async () => {
    const quitar: [string, Record<string, unknown>][] = [
      ['lugar', { lugar_nacimiento: null }],
      ['nacionalidad', { nacionalidad: null }],
      ['nacionalidad vacía', { nacionalidad: '' }],
      ['hermanos', { hermanos_total: null, hermanos_lugar: null }],
      ['apellidos', { primer_apellido: null, segundo_apellido: null }],
      ['fecha', { fecha_nacimiento: null }],
    ]
    for (const [que, parche] of quitar) {
      await completarDatosAlta(carla)
      const r = await serviceClient
        .from('ninos')
        .update({ primer_apellido: 'Apellido Test', fecha_nacimiento: '2024-03-15', ...parche })
        .eq('id', carla)
      if (r.error) throw new Error(r.error.message)
      const { error } = await cierra('madre', carla)
      expect.soft(error?.hint, que).toBe('datos_nino_por_completar')
      expect.soft(await estado(carla), que).toBe('pendiente')
      await aPendiente(carla) // por si alguno cerró: el siguiente parte del mismo sitio
    }
    // Control positivo: con todo puesto, cierra.
    await serviceClient
      .from('ninos')
      .update({ primer_apellido: 'Apellido Test', fecha_nacimiento: '2024-03-15' })
      .eq('id', carla)
    await completarDatosAlta(carla)
    const { data, error } = await cierra('madre', carla)
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(await estado(carla)).toBe('lista')
  })

  it('no es retroactivo: cerrar a Ana (validada, sin los tres) no da error ni la toca', async () => {
    const { data, error } = await cierra('madre', ana)
    expect(error).toBeNull()
    expect(data).toBeNull()
    expect(await estado(ana)).toBe('activa')
  })

  it('la Dirección no puede usar la función de la tutora (42501): por eso escribe con su sesión', async () => {
    const { error } = await sesion.admin.rpc('actualizar_identidad_nino_tutor', {
      p_nino_id: pablo,
      p_primer_apellido: null,
      p_segundo_apellido: null,
      p_fecha_nacimiento: null,
      p_sexo: null,
      p_nacionalidad: null,
      p_idioma_principal: 'es',
      p_lugar_nacimiento: 'Lugar Papel',
    } as unknown as Database['public']['Functions']['actualizar_identidad_nino_tutor']['Args'])
    expect(error?.code).toBe('42501')
    expect((await ficha(pablo))?.lugar_nacimiento).toBeNull()
  })

  it('la tutora y el autorizado no tienen el camino directo: 0 filas y la ficha igual', async () => {
    for (const quien of ['madre', 'tio'] as const) {
      const { data, error } = await sesion[quien]
        .from('ninos')
        .update({
          lugar_nacimiento: 'Lugar Colado',
          nacionalidad: 'Colada',
          hermanos_total: 1,
          hermanos_lugar: 1,
        })
        .eq('id', pablo)
        .select('id')
      expect.soft(error, quien).toBeNull()
      expect.soft(data ?? [], quien).toHaveLength(0)
    }
    expect(await ficha(pablo)).toMatchObject(LOS_TRES)
  })

  it('la Dirección escribe con su sesión (con los CHECK) y entonces cierra el alta en papel', async () => {
    const mala = await sesion.admin
      .from('ninos')
      .update({ dni: '12345678A' })
      .eq('id', pablo)
      .select('id')
    expect(mala.error?.code).toBe('23514') // el DNI con la letra mala no entra tampoco por aquí
    const { data, error } = await sesion.admin
      .from('ninos')
      .update({
        lugar_nacimiento: 'Lugar Papel',
        nacionalidad: 'Nacionalidad Papel',
        hermanos_total: 2,
        hermanos_lugar: 1,
      })
      .eq('id', pablo)
      .select('id')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    const cierre = await cierra('admin', pablo)
    expect(cierre.error).toBeNull()
    expect(await estado(pablo)).toBe('lista')
  })

  it('«familia nueva» cuenta también a los hermanos de baja (lo que la tutora ya no ve)', async () => {
    const { data: n } = await serviceClient
      .from('ninos')
      .select('familia_id, centro_id')
      .eq('id', ana)
      .single()
    expect(await esFamiliaNuevaEnCentro(ana, n!.familia_id)).toBe(true) // premisa: sola en su familia
    const { data: hermano, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: n!.centro_id,
        familia_id: n!.familia_id,
        nombre: 'Hermano De Baja',
        primer_apellido: 'Apellido Test',
        fecha_nacimiento: '2022-01-01',
        deleted_at: new Date().toISOString(),
        deleted_reason: 'baja_nino',
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    // Premisa: la madre (con su sesión) no lo ve; aun así, la familia ya no es nueva.
    const visto = await sesion.madre.from('ninos').select('id').eq('id', hermano!.id)
    expect(visto.data ?? []).toHaveLength(0)
    expect(await esFamiliaNuevaEnCentro(ana, n!.familia_id)).toBe(false)
  })
})
