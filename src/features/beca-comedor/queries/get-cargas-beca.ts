import 'server-only'

import { getCursoActivo, type CursoListItem } from '@/features/cursos/queries/get-cursos'
import { createClient } from '@/lib/supabase/server'

import {
  agruparCargas,
  mesCerrado,
  mesesDelCurso,
  type CargaAgrupada,
  type MesCurso,
} from '../lib/cargas'

export interface CargaBecaItem extends CargaAgrupada {
  /** El mes de APLICACIÓN está cerrado (fila en cierre_mensual). */
  cerrada: boolean
  /**
   * Editable = el mes de APLICACIÓN sigue ABIERTO (sin fila en cierre_mensual). Desde el PR-10,
   * con tramos ya descontados también: esos no se tocan, pero se cambia el resto y se añade a
   * los becados nuevos.
   */
  editable: boolean
  /** Borrable = abierta y sin ningún tramo descontado (PR-5: `beca_tramo_proteger`). */
  borrable: boolean
}

export interface CargasBecaData {
  curso: CursoListItem | null
  /** Meses del curso (año+mes) para los selectores del formulario. */
  meses: MesCurso[]
  /** Meses de aplicación CERRADOS (para bloquear su selección). */
  mesesCerrados: MesCurso[]
  cargas: CargaBecaItem[]
  /** Nombre de los alumnos con tramo, también de los que ya no están matriculados. */
  nombres: Record<string, string>
  /**
   * PR-10: `"{ninoId}:{anio}-{mes}"` de cada alumno cuyo recibo regular de ese mes ya no está en
   * borrador. El motor no regenera ese recibo, así que una beca nueva de ese mes no entra
   * hasta que vuelva a borrador: el formulario lo avisa.
   */
  recibosValidados: string[]
}

/**
 * V2-3 — cargas de beca comedor del curso activo, agrupadas (una fila por mes correspondiente)
 * con el importe de cada alumno (PR-10). Cada carga marca `editable` según si su mes de
 * aplicación sigue abierto. Solo `origen='normal'` (los 'resto' de desborde —V2-4— no son
 * cargas).
 */
export async function getCargasBeca(centroId: string): Promise<CargasBecaData> {
  const vacio = {
    meses: [],
    mesesCerrados: [],
    cargas: [],
    nombres: {},
    recibosValidados: [],
  }
  const curso = await getCursoActivo(centroId)
  if (!curso) return { curso: null, ...vacio }

  const supabase = await createClient()

  const [{ data: tramos }, { data: cierres }, { data: elig }] = await Promise.all([
    supabase
      .from('beca_comedor_tramo')
      .select(
        'nino_id, anio_correspondiente, mes_correspondiente, anio_aplicacion, mes_aplicacion, importe_centimos, estado'
      )
      .eq('centro_id', centroId)
      .eq('curso_academico_id', curso.id)
      .eq('origen', 'normal'),
    supabase.from('cierre_mensual').select('anio, mes').eq('centro_id', centroId),
    supabase
      .from('beca_comedor_elegibilidad')
      .select('nino_id')
      .eq('centro_id', centroId)
      .eq('curso_academico_id', curso.id)
      .eq('activa', true),
  ])

  const mesesCerrados: MesCurso[] = (cierres ?? []).map((c) => ({ anio: c.anio, mes: c.mes }))

  const cargas: CargaBecaItem[] = agruparCargas(tramos ?? []).map((c) => {
    const cerrada = mesCerrado(mesesCerrados, c.anioAplicacion, c.mesAplicacion)
    return { ...c, cerrada, editable: !cerrada, borrable: !cerrada && c.nAplicados === 0 }
  })

  // Los alumnos que pueden salir en el formulario: los becados y los que tienen tramo.
  const ninoIds = [
    ...new Set([...(tramos ?? []).map((t) => t.nino_id), ...(elig ?? []).map((e) => e.nino_id)]),
  ]
  const { nombres, recibosValidados } =
    ninoIds.length === 0
      ? { nombres: {}, recibosValidados: [] }
      : await nombresYValidados(supabase, centroId, ninoIds)

  return {
    curso,
    meses: mesesDelCurso(curso.fecha_inicio, curso.fecha_fin),
    mesesCerrados,
    cargas,
    nombres,
    recibosValidados,
  }
}

type Supa = Awaited<ReturnType<typeof createClient>>

async function nombresYValidados(
  supabase: Supa,
  centroId: string,
  ninoIds: string[]
): Promise<{ nombres: Record<string, string>; recibosValidados: string[] }> {
  const { data: ninos } = await supabase
    .from('ninos')
    .select('id, nombre, apellidos, familia_id')
    .eq('centro_id', centroId)
    .in('id', ninoIds)
  const nombres: Record<string, string> = {}
  const ninosDeFamilia = new Map<string, string[]>()
  for (const n of ninos ?? []) {
    nombres[n.id] = [n.nombre, n.apellidos].filter(Boolean).join(' ').trim() || n.nombre
    ninosDeFamilia.set(n.familia_id, [...(ninosDeFamilia.get(n.familia_id) ?? []), n.id])
  }
  if (ninosDeFamilia.size === 0) return { nombres, recibosValidados: [] }

  // El recibo regular de la familia (sin esporádicos, re-giros ni borrados), fuera de borrador.
  const { data: recibos } = await supabase
    .from('recibos')
    .select('familia_id, anio, mes')
    .eq('centro_id', centroId)
    .in('familia_id', [...ninosDeFamilia.keys()])
    .eq('es_esporadico', false)
    .is('devuelto_de_recibo_id', null)
    .is('deleted_at', null)
    .neq('estado', 'borrador')
  const recibosValidados = (recibos ?? []).flatMap((r) =>
    (ninosDeFamilia.get(r.familia_id) ?? []).map((id) => `${id}:${r.anio}-${r.mes}`)
  )
  return { nombres, recibosValidados }
}
