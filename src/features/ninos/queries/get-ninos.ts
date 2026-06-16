import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface NinoListItem {
  id: string
  nombre: string
  // Nullable: un esqueleto de niño (alta tutor-driven) aún no tiene identidad —
  // la completa el tutor en el wizard. Solo aflora aquí (lista de gestión).
  apellidos: string | null
  fecha_nacimiento: string | null
  aula_actual: string | null
  /** estado de la matrícula vigente (fecha_baja IS NULL): 'pendiente' = esqueleto. */
  estado_matricula: 'pendiente' | 'activa' | null
}

/**
 * Helper defensivo: Supabase puede devolver un embebido como objeto o como
 * array (depende de cómo infiera la cardinalidad). Aceptamos ambos formatos.
 */
function extraerNombreAula(raw: unknown): string | null {
  if (!raw) return null
  if (Array.isArray(raw)) {
    const first = raw[0]
    if (first && typeof first === 'object' && 'nombre' in first) {
      return (first as { nombre: string }).nombre
    }
    return null
  }
  if (typeof raw === 'object' && 'nombre' in raw) {
    return (raw as { nombre: string }).nombre
  }
  return null
}

export async function getNinosPorCentro(centroId: string): Promise<NinoListItem[]> {
  const supabase = await createClient()
  // Doble query: niños del centro + matrícula activa para cada uno con aula.nombre.
  // Hacerlo separado evita complejidad de embebido y permite RLS independiente.
  const { data: ninos } = await supabase
    .from('ninos')
    .select('id, nombre, apellidos, fecha_nacimiento')
    .eq('centro_id', centroId)
    .is('deleted_at', null)
    .order('apellidos', { ascending: true })

  if (!ninos?.length) return []

  const { data: matriculas } = await supabase
    .from('matriculas')
    .select('nino_id, estado, aulas(nombre)')
    .in(
      'nino_id',
      ninos.map((n) => n.id)
    )
    .is('fecha_baja', null)
    .is('deleted_at', null)

  const aulaPorNino = new Map<string, string>()
  const estadoPorNino = new Map<string, 'pendiente' | 'activa'>()
  for (const m of matriculas ?? []) {
    const nombre = extraerNombreAula(m.aulas)
    if (nombre) aulaPorNino.set(m.nino_id, nombre)
    if (m.estado === 'pendiente' || m.estado === 'activa') estadoPorNino.set(m.nino_id, m.estado)
  }

  return ninos.map((n) => ({
    ...n,
    aula_actual: aulaPorNino.get(n.id) ?? null,
    estado_matricula: estadoPorNino.get(n.id) ?? null,
  }))
}

export interface NinoDetalle {
  id: string
  centro_id: string
  nombre: string
  // Nullable en el esqueleto (alta tutor-driven): el tutor completa identidad en el wizard.
  apellidos: string | null
  fecha_nacimiento: string | null
  sexo: 'F' | 'M' | 'X' | null
  nacionalidad: string | null
  idioma_principal: string
  notas_admin: string | null
  puede_aparecer_en_fotos: boolean
  /** Ruta en Storage (bucket privado `ninos-fotos`); se firma para mostrar. F10-3. */
  foto_url: string | null
}

export async function getNinoById(ninoId: string): Promise<NinoDetalle | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('ninos')
    .select(
      'id, centro_id, nombre, apellidos, fecha_nacimiento, sexo, nacionalidad, idioma_principal, notas_admin, puede_aparecer_en_fotos, foto_url'
    )
    .eq('id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()
  return (data as NinoDetalle | null) ?? null
}

export interface InfoMedica {
  alergias_graves: string | null
  notas_emergencia: string | null
  medicacion_habitual: string | null
  alergias_leves: string | null
  medico_familia: string | null
  telefono_emergencia: string | null
}

export async function getInfoMedica(ninoId: string): Promise<InfoMedica | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_info_medica_emergencia', { p_nino_id: ninoId })
  if (error || !data || data.length === 0) return null
  const row = data[0]
  return {
    alergias_graves: row.alergias_graves ?? null,
    notas_emergencia: row.notas_emergencia ?? null,
    medicacion_habitual: row.medicacion_habitual ?? null,
    alergias_leves: row.alergias_leves ?? null,
    medico_familia: row.medico_familia ?? null,
    telefono_emergencia: row.telefono_emergencia ?? null,
  }
}

export interface MatriculaItem {
  id: string
  aula_id: string
  aula_nombre: string
  fecha_alta: string
  fecha_baja: string | null
  motivo_baja: string | null
  estado: 'pendiente' | 'activa' | 'baja'
}

export async function getMatriculasPorNino(ninoId: string): Promise<MatriculaItem[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('matriculas')
    .select('id, aula_id, fecha_alta, fecha_baja, motivo_baja, estado, aulas(nombre)')
    .eq('nino_id', ninoId)
    .is('deleted_at', null)
    .order('fecha_alta', { ascending: false })

  return (data ?? []).map((m) => ({
    id: m.id,
    aula_id: m.aula_id,
    aula_nombre: extraerNombreAula(m.aulas) ?? '—',
    fecha_alta: m.fecha_alta,
    fecha_baja: m.fecha_baja,
    motivo_baja: m.motivo_baja,
    estado: m.estado,
  }))
}
