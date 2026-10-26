import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { hoyMadrid, offsetDias } from '@/features/agenda-diaria/lib/fecha'

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
  serviceClient,
  type TestAula,
  type TestUser,
} from './setup'

/**
 * PR 0 de la Fase 5 — las lecturas de lista filtran por el centro de la página. La RLS dice quién
 * ve una fila, no de qué centro es la página: a quien es Dirección en dos centros (y al
 * superusuario, admin de todos) le devuelve las de los dos. Cada caso, con las consultas reales y
 * la sesión de verdad, pide el centro A y el centro B y comprueba que cada uno trae solo lo suyo.
 * La premisa va delante: con su sesión, sin filtro, esa persona ve las filas de los dos centros.
 */

const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))

const { getAutorizacionesAdmin } =
  await import('@/features/autorizaciones/queries/get-autorizaciones-admin')
const { getPlantillasCatalogo } =
  await import('@/features/autorizaciones/queries/get-plantillas-catalogo')
const { getPlantillasParaEnviar } =
  await import('@/features/autorizaciones/queries/get-plantillas-para-enviar')
const { listarCambiosPendientes, contarCambiosPendientes } =
  await import('@/features/cambios-pendientes/queries/get-cola')
const { getPlantillasInforme } = await import('@/features/informes/queries/get-plantillas-informe')
const { getResumenAsistenciaCentro } =
  await import('@/features/asistencia/queries/get-resumen-asistencia-centro')
const { getAvisosInicio } = await import('@/features/notificaciones/queries/get-avisos-inicio')
const { getAulasParaRecordatorios } =
  await import('@/features/recordatorios/queries/get-aulas-para-recordatorios')
const { getInformesDeMisAulas } = await import('@/features/informes/queries/get-informes-profe')

const TEXTO = 'Texto de prueba del formato, definitivo para el test.'
const ESTRUCTURA = [{ titulo: 'Autonomía', items: [{ id: 'item-1', texto: 'Come solo' }] }]

/**
 * El día de calendario en Madrid a `dias` de hoy. Se cuenta en el calendario, no restando 24 h:
 * el día del cambio de hora tiene 23 o 25.
 */
function ymdMadrid(dias = 0): string {
  return offsetDias(hoyMadrid(), dias)
}

interface Centro {
  id: string
  aula: TestAula
  nino: string
  medicacion: string
  plantillaReglas: string
  plantillaInforme: string
  cambio: string
}

describe('Lecturas por centro: Dirección y profe en dos centros', () => {
  let direccion: TestUser // admin de A y de B
  let profe: TestUser // profe en A y en B, con un aula en cada uno
  let tutor: TestUser
  let cDireccion: SupabaseClient<Database>
  let cProfe: SupabaseClient<Database>
  const centros: Centro[] = []
  let A: Centro
  let B: Centro

  async function montarCentro(nombre: string): Promise<Centro> {
    const centro = await createTestCentro(`Centro Lecturas ${nombre}`)
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id, `Aula Lecturas ${nombre}`)
    const nino = await createTestNino(centro.id)
    await asignarRol(direccion.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarProfeAula(profe.id, aula.id, curso.id)

    const plantilla = async (tipo: 'medicacion' | 'reglas_regimen_interno') => {
      const { data, error } = await serviceClient
        .from('autorizaciones')
        .insert({
          centro_id: centro.id,
          tipo,
          es_plantilla: true,
          titulo: `Formato ${tipo} ${nombre}`,
          texto: TEXTO,
          texto_version: 'v1',
          texto_definitivo: true,
          estado: 'publicada',
          creado_por: direccion.id,
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(`plantilla ${tipo}: ${error?.message}`)
      return data.id
    }
    const plantillaMed = await plantilla('medicacion')
    const plantillaReglas = await plantilla('reglas_regimen_interno')

    // Una medicación terminada ayer y sin archivar: es una instancia (listado de Dirección) y
    // cuenta en «medicaciones por archivar» del inicio.
    const { data: med, error: medErr } = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'medicacion',
        es_plantilla: false,
        plantilla_id: plantillaMed,
        ambito: 'nino',
        nino_id: nino.id,
        titulo: `Medicación ${nombre}`,
        texto: TEXTO,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        firmantes_requeridos: 'uno_principal',
        vigencia_desde: ymdMadrid(-10),
        vigencia_hasta: ymdMadrid(-1),
        creado_por: tutor.id,
      })
      .select('id')
      .single()
    if (medErr || !med) throw new Error(`medicación: ${medErr?.message}`)

    const { data: pi, error: piErr } = await serviceClient
      .from('plantillas_informe')
      .insert({
        centro_id: centro.id,
        titulo: `Plantilla ${nombre} ${randomUUID().slice(0, 8)}`,
        estructura: ESTRUCTURA,
        creado_por: direccion.id,
      })
      .select('id')
      .single()
    if (piErr || !pi) throw new Error(`plantilla de informe: ${piErr?.message}`)

    const { data: cambio, error: cErr } = await serviceClient
      .from('cambios_pendientes')
      .insert({
        centro_id: centro.id,
        nino_id: nino.id,
        entidad: 'ninos_familia',
        registro_id: nino.id,
        payload: { direccion_calle: `Calle ${nombre}` },
        solicitado_por: tutor.id,
      })
      .select('id')
      .single()
    if (cErr || !cambio) throw new Error(`cambio pendiente: ${cErr?.message}`)

    return {
      id: centro.id,
      aula,
      nino: nino.id,
      medicacion: med.id,
      plantillaReglas,
      plantillaInforme: pi.id,
      cambio: cambio.id,
    }
  }

  beforeAll(async () => {
    direccion = await createTestUser({ nombre: 'Direccion Dos Centros' })
    profe = await createTestUser({ nombre: 'Profe Dos Centros' })
    tutor = await createTestUser({ nombre: 'Tutor Lecturas' })
    A = await montarCentro('A')
    B = await montarCentro('B')
    centros.push(A, B)
    cDireccion = await clientFor(direccion)
    cProfe = await clientFor(profe)
  }, 120_000)

  afterAll(async () => {
    sesion.actual = null
    for (const c of centros) {
      await serviceClient.from('cambios_pendientes').delete().eq('id', c.cambio)
      await serviceClient.from('plantillas_informe').delete().eq('id', c.plantillaInforme)
      await deleteTestCentro(c.id)
    }
    for (const u of [direccion, profe, tutor]) if (u) await deleteTestUser(u.id)
  }, 120_000)

  it('premisa: con su sesión y sin filtro, Dirección ve las filas de los dos centros', async () => {
    const centrosDe = async (tabla: 'autorizaciones' | 'cambios_pendientes' | 'aulas') => {
      const { data, error } = await cDireccion
        .from(tabla)
        .select('centro_id')
        .in('centro_id', [A.id, B.id])
      expect(error).toBeNull()
      return new Set((data ?? []).map((r) => r.centro_id))
    }
    expect(await centrosDe('autorizaciones')).toEqual(new Set([A.id, B.id]))
    expect(await centrosDe('cambios_pendientes')).toEqual(new Set([A.id, B.id]))
    expect(await centrosDe('aulas')).toEqual(new Set([A.id, B.id]))
    const { data: aulasProfe } = await cProfe
      .from('profes_aulas')
      .select('aula_id')
      .eq('profe_id', profe.id)
    expect(new Set((aulasProfe ?? []).map((r) => r.aula_id))).toEqual(
      new Set([A.aula.id, B.aula.id])
    )
  })

  it('autorizaciones: instancias, catálogo y plantillas enviables, cada centro las suyas', async () => {
    sesion.actual = cDireccion
    for (const [mio, otro] of [
      [A, B],
      [B, A],
    ]) {
      const instancias = (await getAutorizacionesAdmin(mio.id)).map((a) => a.id)
      expect(instancias).toContain(mio.medicacion)
      expect(instancias).not.toContain(otro.medicacion)

      const catalogo = await getPlantillasCatalogo(mio.id)
      expect(catalogo.map((p) => p.id)).toContain(mio.plantillaReglas)
      expect(catalogo.map((p) => p.id)).not.toContain(otro.plantillaReglas)
      expect(catalogo).toHaveLength(2) // su medicación y sus normas

      const enviables = (await getPlantillasParaEnviar(mio.id)).map((p) => p.id)
      expect(enviables).toEqual([mio.plantillaReglas])
    }
  })

  it('cola de cambios pendientes y su contador, cada centro los suyos', async () => {
    sesion.actual = cDireccion
    for (const [mio, otro] of [
      [A, B],
      [B, A],
    ]) {
      const cola = (await listarCambiosPendientes(mio.id)).map((c) => c.id)
      expect(cola).toContain(mio.cambio)
      expect(cola).not.toContain(otro.cambio)
      expect(await contarCambiosPendientes(mio.id)).toBe(1)
    }
  })

  it('plantillas de informe, cada centro las suyas', async () => {
    sesion.actual = cDireccion
    expect((await getPlantillasInforme(A.id)).map((p) => p.id)).toEqual([A.plantillaInforme])
    expect((await getPlantillasInforme(B.id)).map((p) => p.id)).toEqual([B.plantillaInforme])
  })

  it('resumen de asistencia del inicio de Dirección: solo las aulas del centro', async () => {
    sesion.actual = cDireccion
    const hoy = ymdMadrid(0)
    expect((await getResumenAsistenciaCentro(A.id, hoy)).map((r) => r.aula_id)).toEqual([A.aula.id])
    expect((await getResumenAsistenciaCentro(B.id, hoy)).map((r) => r.aula_id)).toEqual([B.aula.id])
  })

  it('avisos del inicio de Dirección: las medicaciones por archivar del centro', async () => {
    sesion.actual = cDireccion
    expect((await getAvisosInicio('admin', A.id)).medicacionesPorArchivar).toBe(1)
    expect((await getAvisosInicio('admin', B.id)).medicacionesPorArchivar).toBe(1)
  })

  it('la profe con aula en dos centros: sus aulas de recordatorios y de informes, las del centro', async () => {
    sesion.actual = cProfe
    for (const [mio, otro] of [
      [A, B],
      [B, A],
    ]) {
      const recordatorios = (await getAulasParaRecordatorios('profe', mio.id)).map((a) => a.id)
      expect(recordatorios).toEqual([mio.aula.id])
      const informes = (await getInformesDeMisAulas(mio.id)).map((a) => a.id)
      expect(informes).toContain(mio.aula.id)
      expect(informes).not.toContain(otro.aula.id)
    }
  })
})
