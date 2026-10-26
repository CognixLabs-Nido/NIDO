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

/** PR-6: un concepto activo del catálogo, manual o automático, con lo que hace falta para
 * enseñar y fijar el importe (o, desde PR-8, el porcentaje) propio de una asignación. */
export interface ConceptoCatalogo {
  id: string
  nombre: string
  tipo_concepto: TipoConcepto
  tipo_valor: string
  signo: number
  importe_centimos: number | null
  porcentaje_bp: number | null
  tarifa_por_anio_nacimiento: boolean
  concepto_base_id: string | null
  /** Nombre de la base, para decir sobre qué se calcula el porcentaje. */
  concepto_base_nombre: string | null
}

/** El valor propio de una asignación: un importe fijo (PR-6) o un porcentaje de la base (PR-8). */
export type ValorPropio = { tipo: 'fijo'; centimos: number } | { tipo: 'porcentaje'; bp: number }

/** Valor propio por concepto asignado; solo los que lo tienen. */
export type ImportesPropios = Record<string, ValorPropio>

export interface AlumnoAsignacion {
  ninoId: string
  nombre: string
  familiaEtiqueta: string
  conceptosAsignados: string[]
  importesPropios: ImportesPropios
}

export interface FamiliaAsignacion {
  familiaId: string
  etiqueta: string
  tutores: string[]
  conceptosAsignados: string[]
  importesPropios: ImportesPropios
}

export interface AsignacionPermanente {
  alumnos: AlumnoAsignacion[]
  familias: FamiliaAsignacion[]
  conceptosNino: ConceptoAsignablePermanente[]
  conceptosFamilia: ConceptoAsignablePermanente[]
  /** PR-6: todos los conceptos activos (también los automáticos, que no salen para asignar). */
  catalogo: ConceptoCatalogo[]
}

const VACIO: AsignacionPermanente = {
  alumnos: [],
  familias: [],
  conceptosNino: [],
  conceptosFamilia: [],
  catalogo: [],
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

  const [familiasRes, tutoresRes, conceptosRes, asignRes, catalogoRes] = await Promise.all([
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
      .select('nino_id, familia_id, concepto_id, importe_override_centimos, porcentaje_override_bp')
      .eq('centro_id', centroId)
      .is('deleted_at', null),
    supabase
      .from('conceptos_cobro')
      .select(
        'id, nombre, tipo_concepto, tipo_valor, signo, importe_centimos, porcentaje_bp, tarifa_por_anio_nacimiento, servicio, concepto_base_id'
      )
      .eq('centro_id', centroId)
      .eq('activo', true)
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
  const importesPorNino = new Map<string, ImportesPropios>()
  const importesPorFamilia = new Map<string, ImportesPropios>()
  for (const a of asignRes.data ?? []) {
    const destino = a.nino_id ?? a.familia_id
    if (!destino) continue
    const conceptos = a.nino_id ? conceptosPorNino : conceptosPorFamilia
    conceptos.set(destino, [...(conceptos.get(destino) ?? []), a.concepto_id])
    // Nunca van los dos juntos (CHECK `asignacion_concepto_un_valor_propio`).
    const valor: ValorPropio | null =
      a.porcentaje_override_bp != null
        ? { tipo: 'porcentaje', bp: a.porcentaje_override_bp }
        : a.importe_override_centimos != null
          ? { tipo: 'fijo', centimos: a.importe_override_centimos }
          : null
    if (valor) {
      const importes = a.nino_id ? importesPorNino : importesPorFamilia
      importes.set(destino, { ...(importes.get(destino) ?? {}), [a.concepto_id]: valor })
    }
  }

  const alumnos: AlumnoAsignacion[] = ninos
    .map((n) => ({
      ninoId: n.id,
      nombre: [n.nombre, n.apellidos].filter(Boolean).join(' '),
      familiaEtiqueta: n.familia_id ? (etiquetaPorFamilia.get(n.familia_id) ?? '') : '',
      conceptosAsignados: conceptosPorNino.get(n.id) ?? [],
      importesPropios: importesPorNino.get(n.id) ?? {},
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-ES'))

  const familias: FamiliaAsignacion[] = familiaIds
    .map((id) => ({
      familiaId: id,
      etiqueta: etiquetaPorFamilia.get(id) ?? '',
      tutores: tutoresPorFamilia.get(id) ?? [],
      conceptosAsignados: conceptosPorFamilia.get(id) ?? [],
      importesPropios: importesPorFamilia.get(id) ?? {},
    }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es-ES'))

  const catalogoFilas = catalogoRes.data ?? []
  const nombrePorConcepto = new Map(catalogoFilas.map((c) => [c.id, c.nombre]))
  const catalogo: ConceptoCatalogo[] = catalogoFilas
    .map((c) => ({
      id: c.id,
      nombre: c.nombre,
      tipo_concepto: c.tipo_concepto,
      tipo_valor: c.tipo_valor,
      signo: c.signo,
      importe_centimos: c.importe_centimos,
      porcentaje_bp: c.porcentaje_bp,
      tarifa_por_anio_nacimiento: c.tarifa_por_anio_nacimiento,
      concepto_base_id: c.concepto_base_id,
      concepto_base_nombre: c.concepto_base_id
        ? (nombrePorConcepto.get(c.concepto_base_id) ?? null)
        : null,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-ES'))

  return { alumnos, familias, conceptosNino, conceptosFamilia, catalogo }
}
