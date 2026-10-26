import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestNino,
  type TestUser,
} from './setup'

/**
 * El aviso «Alergia grave» (y «Medicación») en el pase de lista, la agenda del aula y el
 * comedor, con la sesión de la profe del aula y contra el esquema real.
 *
 * Las cuatro consultas filtraban por `info_medica_emergencia.deleted_at`, una columna que la
 * tabla no ha tenido nunca: PostgREST contestaba 42703, el error se ignoraba y todos los niños
 * salían sin aviso, también el que tiene una alergia grave apuntada. Que un fallo de esa consulta
 * no vuelva a pintarse como «sin alergia» lo prueba `src/test/alertas-medicas/`.
 */

const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))

const { getPaseDeListaAula } = await import('@/features/asistencia/queries/get-pase-de-lista-aula')
const { getAgendasAulaDelDia } =
  await import('@/features/agenda-diaria/queries/get-agendas-aula-del-dia')
const { getPaseDeListaComida } = await import('@/features/menus/queries/get-pase-de-lista-comida')
const { getPaseDeListaComidaTodosMomentos } =
  await import('@/features/menus/queries/get-pase-de-lista-comida-todos-momentos')

// Un miércoles sin fila en el calendario del centro: `tipo_de_dia` da 'lectivo'.
const FECHA = '2026-06-03'

describe('El aviso de alergia grave sale en las listas del aula', () => {
  let centro: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let profe: TestUser
  let cProfe: SupabaseClient<Database>
  let conAlergia: TestNino
  let sinFicha: TestNino
  let fichaVacia: TestNino

  beforeAll(async () => {
    centro = await createTestCentro('Centro Alertas Medicas')
    const curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Alertas Medicas' })
    profe = await createTestUser({ nombre: 'Profe Alertas Medicas' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarProfeAula(profe.id, aula.id, curso.id)
    cProfe = await clientFor(profe)

    conAlergia = await createTestNino(centro.id, 'Niño Demo Alergia')
    sinFicha = await createTestNino(centro.id, 'Niño Demo Sin Ficha')
    await matricular(conAlergia.id, aula.id, curso.id)
    await matricular(sinFicha.id, aula.id, curso.id)
    fichaVacia = await createTestNino(centro.id, 'Niño Demo Ficha Vacia')
    await matricular(fichaVacia.id, aula.id, curso.id)

    // La ficha médica, como la guarda la app: por la RPC que cifra la alergia grave.
    const cAdmin = await clientFor(admin)
    const ficha = await cAdmin.rpc('set_info_medica_emergencia_cifrada', {
      p_nino_id: conAlergia.id,
      p_alergias_graves: 'Alergia grave ficticia',
      p_notas_emergencia: 'Nota ficticia',
      p_medicacion_habitual: 'Medicación ficticia',
      p_alergias_leves: 'Ninguna',
      p_medico_familia: 'Médico Demo',
      p_telefono_emergencia: '600000000',
    })
    if (ficha.error) throw new Error(`ficha médica: ${ficha.error.message}`)
    // Una ficha con la alergia grave y la medicación vacías (20261123120000: vacío = NULL).
    const vacia = await cAdmin.rpc('set_info_medica_emergencia_cifrada', {
      p_nino_id: fichaVacia.id,
      p_alergias_graves: '',
      p_notas_emergencia: '',
      p_medicacion_habitual: '   ',
      p_alergias_leves: 'Ninguna',
      p_medico_familia: 'Médico Demo',
      p_telefono_emergencia: '600000000',
    })
    if (vacia.error) throw new Error(`ficha vacía: ${vacia.error.message}`)

    // El comedor solo pinta la lista con menú publicado para ese día.
    const plantilla = await serviceClient
      .from('plantillas_menu_mensual')
      .insert({
        centro_id: centro.id,
        mes: 6,
        anio: 2026,
        estado: 'publicada',
        creada_por: admin.id,
      })
      .select('id')
      .single()
    if (plantilla.error || !plantilla.data)
      throw new Error(`plantilla: ${plantilla.error?.message}`)
    const menu = await serviceClient.from('menu_dia').insert({
      plantilla_id: plantilla.data.id,
      fecha: FECHA,
      comida_primero: 'Macarrones',
      comida_segundo: 'Pollo asado',
      comida_postre: 'Yogur',
    })
    if (menu.error) throw new Error(`menu_dia: ${menu.error.message}`)

    sesion.actual = cProfe
  }, 60_000)

  afterAll(async () => {
    sesion.actual = null
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(profe.id)
  }, 60_000)

  it('premisa: la profe del aula lee la fila médica del niño, con la alergia grave apuntada', async () => {
    const { data, error } = await cProfe
      .from('info_medica_emergencia')
      .select('nino_id, alergias_graves')
      .in('nino_id', [conAlergia.id, sinFicha.id, fichaVacia.id])
    expect(error).toBeNull()
    // Dos filas: la del niño con alergia, con la alergia grave apuntada, y la ficha vacía.
    expect(data).toHaveLength(2)
    expect(data?.find((d) => d.nino_id === conAlergia.id)?.alergias_graves).not.toBeNull()
  })

  it('pase de lista: alergia grave y medicación en su niño, nada en los otros', async () => {
    const filas = await getPaseDeListaAula(aula.id, FECHA)
    const de = (id: string) => filas.find((f) => f.nino.id === id)?.alertas
    expect(filas).toHaveLength(3)
    expect(de(conAlergia.id)).toEqual({ alergia_grave: true, medicacion: true })
    expect(de(sinFicha.id)).toEqual({ alergia_grave: false, medicacion: false })
    expect(de(fichaVacia.id)).toEqual({ alergia_grave: false, medicacion: false })
  })

  it('agenda del aula: alergia grave y medicación en su niño, nada en los otros', async () => {
    const filas = await getAgendasAulaDelDia(aula.id, FECHA)
    const de = (id: string) => filas.find((f) => f.nino.id === id)?.alertas
    expect(filas).toHaveLength(3)
    expect(de(conAlergia.id)).toEqual({ alergia_grave: true, medicacion: true })
    expect(de(sinFicha.id)).toEqual({ alergia_grave: false, medicacion: false })
    expect(de(fichaVacia.id)).toEqual({ alergia_grave: false, medicacion: false })
  })

  it('comedor, un momento: el aviso en su niño, no en los otros', async () => {
    const estado = await getPaseDeListaComida(aula.id, FECHA, 'comida')
    expect(estado.kind).toBe('listo')
    if (estado.kind !== 'listo') return
    const de = (id: string) => estado.filas.find((f) => f.nino.id === id)?.alergiaGrave
    expect(estado.filas).toHaveLength(3)
    expect(de(conAlergia.id)).toBe(true)
    expect(de(sinFicha.id)).toBe(false)
    expect(de(fichaVacia.id)).toBe(false)
  })

  it('comedor, todos los momentos: el aviso en su niño, no en los otros', async () => {
    const estados = await getPaseDeListaComidaTodosMomentos(aula.id, FECHA)
    for (const estado of Object.values(estados)) {
      expect(estado.kind).toBe('listo')
      if (estado.kind !== 'listo') continue
      const de = (id: string) => estado.filas.find((f) => f.nino.id === id)?.alergiaGrave
      expect(estado.filas).toHaveLength(3)
      expect(de(conAlergia.id)).toBe(true)
      expect(de(sinFicha.id)).toBe(false)
      expect(de(fichaVacia.id)).toBe(false)
    }
  })
})
