import 'server-only'

import { createClient } from '@/lib/supabase/server'

import {
  PERIODOS_INFORME,
  type CursoInformesFamilia,
  type InformeFamiliaItem,
  type NinoInformesFamilia,
  type PeriodoInforme,
} from '../types'

interface InformeFamiliaRow {
  id: string
  nino_id: string
  periodo: PeriodoInforme
  estado: 'borrador' | 'publicado'
  publicado_at: string | null
  curso_academico_id: string
  ninos: { nombre: string; apellidos: string } | { nombre: string; apellidos: string }[] | null
  cursos_academicos: { nombre: string } | { nombre: string }[] | null
}

function unwrap<T>(v: T | T[] | null): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

const ORDEN_PERIODO: Record<PeriodoInforme, number> = Object.fromEntries(
  PERIODOS_INFORME.map((p, i) => [p, i])
) as Record<PeriodoInforme, number>

/**
 * Informes de evolución PUBLICADOS visibles para la familia actual, agrupados por
 * hijo → curso académico → período (histórico completo, no solo el curso activo).
 * La RLS de `informes_evolucion` (`usuario_es_audiencia_informe_row`) ya filtra a
 * publicados legibles por esta familia (tutor legal siempre; autorizado con
 * `puede_ver_datos_pedagogicos`); aquí solo se ordena y agrupa. Nunca devuelve
 * borradores. Lectura — no expone respuestas (eso es el detalle).
 */
export async function getInformesPublicadosFamilia(): Promise<NinoInformesFamilia[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('informes_evolucion')
    .select(
      'id, nino_id, periodo, estado, publicado_at, curso_academico_id, ninos(nombre, apellidos), cursos_academicos(nombre)'
    )
    .eq('estado', 'publicado')
    .order('publicado_at', { ascending: false })

  const rows = (data ?? []) as InformeFamiliaRow[]

  // niño → (curso → { nombre, items })
  const porNino = new Map<
    string,
    {
      nombre: string
      apellidos: string
      cursos: Map<string, { nombre: string | null; items: InformeFamiliaItem[]; orden: number }>
    }
  >()

  rows.forEach((row, idx) => {
    const nino = unwrap(row.ninos)
    if (!nino) return
    let nentry = porNino.get(row.nino_id)
    if (!nentry) {
      nentry = { nombre: nino.nombre, apellidos: nino.apellidos, cursos: new Map() }
      porNino.set(row.nino_id, nentry)
    }
    let centry = nentry.cursos.get(row.curso_academico_id)
    if (!centry) {
      // `idx` (orden de llegada, ya ordenado por publicado_at desc) fija el orden
      // del curso: el primer informe visto de un curso marca su posición.
      centry = { nombre: unwrap(row.cursos_academicos)?.nombre ?? null, items: [], orden: idx }
      nentry.cursos.set(row.curso_academico_id, centry)
    }
    centry.items.push({
      id: row.id,
      periodo: row.periodo,
      estado: row.estado,
      publicado_at: row.publicado_at,
    })
  })

  const resultado: NinoInformesFamilia[] = []
  for (const [ninoId, nentry] of porNino) {
    const cursos: CursoInformesFamilia[] = Array.from(nentry.cursos.entries())
      .sort((a, b) => a[1].orden - b[1].orden) // curso más reciente primero
      .map(([cursoId, c]) => ({
        cursoId,
        cursoNombre: c.nombre,
        items: c.items.sort((x, y) => ORDEN_PERIODO[x.periodo] - ORDEN_PERIODO[y.periodo]),
      }))
    resultado.push({
      ninoId,
      nombre: nentry.nombre,
      apellidos: nentry.apellidos,
      cursos,
    })
  }

  return resultado.sort((a, b) => a.nombre.localeCompare(b.nombre))
}
