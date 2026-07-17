import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type TipoConcepto = Database['public']['Enums']['tipo_concepto']

export interface ConceptoAsignablePermanente {
  id: string
  nombre: string
  tipo_concepto: TipoConcepto
  signo: number
}

export interface AlumnoAsignacion {
  ninoId: string
  nombre: string
  familiaEtiqueta: string
  conceptosAsignados: string[]
}

export interface FamiliaAsignacion {
  familiaId: string
  etiqueta: string
  tutores: string[]
  conceptosAsignados: string[]
}

export interface AsignacionPermanente {
  alumnos: AlumnoAsignacion[]
  familias: FamiliaAsignacion[]
  conceptosNino: ConceptoAsignablePermanente[]
  conceptosFamilia: ConceptoAsignablePermanente[]
}

const VACIO: AsignacionPermanente = {
  alumnos: [],
  familias: [],
  conceptosNino: [],
  conceptosFamilia: [],
}

/**
 * F-4-4: configuración de asignación PERMANENTE (sin mes, sin método): qué conceptos se
 * asignan a cada ALUMNO (ámbito niño) y a cada FAMILIA (ámbito familia: descuento hermanos,
 * cargos familiares). Solo lectura; el panel edita con las acciones asignar/desasignar.
 */
export async function getAsignacionPermanente(centroId: string): Promise<AsignacionPermanente> {
  const supabase = await createClient()

  const { data: ninosRows } = await supabase
    .from('ninos')
    .select('id, nombre, apellidos, familia_id, matriculas!inner(estado, fecha_baja, deleted_at)')
    .eq('centro_id', centroId)
    .eq('matriculas.estado', 'activa')
    .is('matriculas.fecha_baja', null)
    .is('matriculas.deleted_at', null)
    .is('deleted_at', null)

  const ninos = ninosRows ?? []
  if (ninos.length === 0) return VACIO

  const familiaIds = [
    ...new Set(ninos.map((n) => n.familia_id).filter((x): x is string => x != null)),
  ]

  const [familiasRes, tutoresRes, conceptosRes, asignRes] = await Promise.all([
    supabase.from('familias').select('id, etiqueta').in('id', familiaIds),
    supabase
      .from('familia_tutores')
      .select('familia_id, rol_familia, nombre_completo, usuario:usuarios(nombre_completo)')
      .in('familia_id', familiaIds)
      .is('deleted_at', null),
    supabase
      .from('conceptos_cobro')
      .select('id, nombre, tipo_concepto, signo, ambito')
      .eq('centro_id', centroId)
      .eq('activo', true)
      .eq('aplicacion', 'manual')
      .is('deleted_at', null),
    supabase
      .from('asignacion_concepto')
      .select('nino_id, familia_id, concepto_id')
      .eq('centro_id', centroId)
      .is('deleted_at', null),
  ])

  const etiquetaPorFamilia = new Map((familiasRes.data ?? []).map((f) => [f.id, f.etiqueta]))

  const tutoresPorFamilia = new Map<string, string[]>()
  for (const tr of tutoresRes.data ?? []) {
    const nombre = tr.nombre_completo ?? tr.usuario?.nombre_completo ?? ''
    if (!nombre) continue
    const actual = tutoresPorFamilia.get(tr.familia_id) ?? []
    if (tr.rol_familia === 'titular') actual.unshift(nombre)
    else actual.push(nombre)
    tutoresPorFamilia.set(tr.familia_id, actual)
  }

  const conceptosNino: ConceptoAsignablePermanente[] = []
  const conceptosFamilia: ConceptoAsignablePermanente[] = []
  for (const c of conceptosRes.data ?? []) {
    const item = { id: c.id, nombre: c.nombre, tipo_concepto: c.tipo_concepto, signo: c.signo }
    if (c.ambito === 'familia') conceptosFamilia.push(item)
    else conceptosNino.push(item)
  }
  conceptosNino.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-ES'))
  conceptosFamilia.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-ES'))

  const conceptosPorNino = new Map<string, string[]>()
  const conceptosPorFamilia = new Map<string, string[]>()
  for (const a of asignRes.data ?? []) {
    if (a.nino_id) {
      const actual = conceptosPorNino.get(a.nino_id) ?? []
      actual.push(a.concepto_id)
      conceptosPorNino.set(a.nino_id, actual)
    } else if (a.familia_id) {
      const actual = conceptosPorFamilia.get(a.familia_id) ?? []
      actual.push(a.concepto_id)
      conceptosPorFamilia.set(a.familia_id, actual)
    }
  }

  const alumnos: AlumnoAsignacion[] = ninos
    .map((n) => ({
      ninoId: n.id,
      nombre: [n.nombre, n.apellidos].filter(Boolean).join(' '),
      familiaEtiqueta: n.familia_id ? (etiquetaPorFamilia.get(n.familia_id) ?? '') : '',
      conceptosAsignados: conceptosPorNino.get(n.id) ?? [],
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-ES'))

  const familias: FamiliaAsignacion[] = familiaIds
    .map((id) => ({
      familiaId: id,
      etiqueta: etiquetaPorFamilia.get(id) ?? '',
      tutores: tutoresPorFamilia.get(id) ?? [],
      conceptosAsignados: conceptosPorFamilia.get(id) ?? [],
    }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es-ES'))

  return { alumnos, familias, conceptosNino, conceptosFamilia }
}
