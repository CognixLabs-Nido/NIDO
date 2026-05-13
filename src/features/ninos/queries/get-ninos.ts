import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface NinoListItem {
  id: string
  nombre: string
  apellidos: string
  fecha_nacimiento: string
}

export async function getNinosPorCentro(centroId: string): Promise<NinoListItem[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('ninos')
    .select('id, nombre, apellidos, fecha_nacimiento')
    .eq('centro_id', centroId)
    .is('deleted_at', null)
    .order('apellidos', { ascending: true })
  return (data ?? []) as NinoListItem[]
}

export interface NinoDetalle {
  id: string
  centro_id: string
  nombre: string
  apellidos: string
  fecha_nacimiento: string
  sexo: 'F' | 'M' | 'X' | null
  nacionalidad: string | null
  idioma_principal: string
  notas_admin: string | null
}

export async function getNinoById(ninoId: string): Promise<NinoDetalle | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('ninos')
    .select(
      'id, centro_id, nombre, apellidos, fecha_nacimiento, sexo, nacionalidad, idioma_principal, notas_admin'
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
}

export async function getMatriculasPorNino(ninoId: string): Promise<MatriculaItem[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('matriculas')
    .select('id, aula_id, fecha_alta, fecha_baja, motivo_baja, aulas(nombre)')
    .eq('nino_id', ninoId)
    .is('deleted_at', null)
    .order('fecha_alta', { ascending: false })

  return (data ?? []).map((m) => ({
    id: m.id,
    aula_id: m.aula_id,
    aula_nombre: (m.aulas as { nombre?: string } | null)?.nombre ?? '—',
    fecha_alta: m.fecha_alta,
    fecha_baja: m.fecha_baja,
    motivo_baja: m.motivo_baja,
  }))
}
