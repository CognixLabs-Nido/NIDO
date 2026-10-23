import 'server-only'

import { getCursoActivo, type CursoListItem } from '@/features/cursos/queries/get-cursos'
import { createClient } from '@/lib/supabase/server'

import { agruparCargas, mesCerrado, mesesDelCurso, type MesCurso } from '../lib/cargas'

export interface CargaBecaItem {
  anioCorrespondiente: number
  mesCorrespondiente: number
  anioAplicacion: number
  mesAplicacion: number
  importeCentimos: number
  nBecados: number
  /** PR-5: tramos de la carga ya descontados en un recibo validado. */
  nAplicados: number
  /** El mes de APLICACIÓN está cerrado (fila en cierre_mensual). */
  cerrada: boolean
  /**
   * Editable/borrable = el mes de APLICACIÓN sigue ABIERTO (sin fila en cierre_mensual) y
   * ningún tramo está descontado aún (PR-5: el trigger `beca_tramo_proteger` lo rechazaría).
   */
  editable: boolean
}

export interface CargasBecaData {
  curso: CursoListItem | null
  /** Meses del curso (año+mes) para los selectores del formulario. */
  meses: MesCurso[]
  /** Meses de aplicación CERRADOS (para bloquear su selección). */
  mesesCerrados: MesCurso[]
  cargas: CargaBecaItem[]
}

/**
 * V2-3 — cargas de beca comedor del curso activo, agrupadas (una fila por mes
 * correspondiente). Cada carga marca `editable` según si su mes de aplicación sigue
 * abierto. Solo `origen='normal'` (los 'resto' de desborde —V2-4— no son cargas masivas).
 */
export async function getCargasBeca(centroId: string): Promise<CargasBecaData> {
  const curso = await getCursoActivo(centroId)
  if (!curso) return { curso: null, meses: [], mesesCerrados: [], cargas: [] }

  const supabase = await createClient()

  const [{ data: tramos }, { data: cierres }] = await Promise.all([
    supabase
      .from('beca_comedor_tramo')
      .select(
        'anio_correspondiente, mes_correspondiente, anio_aplicacion, mes_aplicacion, importe_centimos, estado'
      )
      .eq('centro_id', centroId)
      .eq('curso_academico_id', curso.id)
      .eq('origen', 'normal'),
    supabase.from('cierre_mensual').select('anio, mes').eq('centro_id', centroId),
  ])

  const mesesCerrados: MesCurso[] = (cierres ?? []).map((c) => ({ anio: c.anio, mes: c.mes }))

  const cargas: CargaBecaItem[] = agruparCargas(tramos ?? []).map((c) => {
    const cerrada = mesCerrado(mesesCerrados, c.anioAplicacion, c.mesAplicacion)
    return { ...c, cerrada, editable: !cerrada && c.nAplicados === 0 }
  })

  return {
    curso,
    meses: mesesDelCurso(curso.fecha_inicio, curso.fecha_fin),
    mesesCerrados,
    cargas,
  }
}
