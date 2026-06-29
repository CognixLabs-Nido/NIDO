import 'server-only'

import { aplicarMatriculaActiva } from '@/features/matriculas/lib/matricula-activa'
import { createClient } from '@/lib/supabase/server'

import type { ServicioDiario } from '../schemas/parte-servicio'
import type { NinoParteResumen } from '../types'

interface MatriculaJoinNino {
  ninos: {
    id: string
    nombre: string
    apellidos: string
    foto_url: string | null
  } | null
}

interface ParteRow {
  nino_id: string
  servicio: ServicioDiario
  presente: boolean
}

const SERVICIOS: ServicioDiario[] = ['comedor', 'matinera', 'vespertina']

/**
 * Lista los niños matriculados activos en un aula con su parte de servicio
 * para una fecha. Carga los 3 servicios en una sola pasada (el cliente
 * cambia de servicio como state local, sin re-fetch).
 *
 * RLS filtra automáticamente:
 *  - matriculas/ninos: profe del aula o admin.
 *  - parte_servicio_diario: admin o profe del niño (el tutor NO ve nada).
 *
 * Lazy (igual que asistencia, ADR-0015): no se crean filas por adelantado;
 * `null` = nadie lo ha apuntado todavía para ese servicio.
 */
export async function getParteServicioAula(
  aulaId: string,
  fecha: string
): Promise<NinoParteResumen[]> {
  const supabase = await createClient()

  // 1. Niños matriculados activos en el aula.
  const { data: matriculas } = await aplicarMatriculaActiva(
    supabase
      .from('matriculas')
      .select('ninos(id, nombre, apellidos, foto_url)')
      .eq('aula_id', aulaId)
  )

  const ninos = ((matriculas ?? []) as MatriculaJoinNino[])
    .map((m) => m.ninos)
    .filter((n): n is NonNullable<MatriculaJoinNino['ninos']> => n !== null)

  if (ninos.length === 0) return []

  const ninoIds = ninos.map((n) => n.id)

  // 2. Partes ya registrados para esos niños/fecha (los 3 servicios de golpe).
  const { data: partes } = await supabase
    .from('parte_servicio_diario')
    .select('nino_id, servicio, presente')
    .in('nino_id', ninoIds)
    .eq('fecha', fecha)

  const porNino = new Map<string, Record<ServicioDiario, boolean | null>>()
  for (const row of (partes ?? []) as ParteRow[]) {
    const actual = porNino.get(row.nino_id) ?? { comedor: null, matinera: null, vespertina: null }
    actual[row.servicio] = row.presente
    porNino.set(row.nino_id, actual)
  }

  return ninos
    .map((n) => ({
      nino: n,
      servicios:
        porNino.get(n.id) ??
        ({ comedor: null, matinera: null, vespertina: null } as Record<
          ServicioDiario,
          boolean | null
        >),
    }))
    .sort((a, b) => a.nino.nombre.localeCompare(b.nino.nombre))
}

export { SERVICIOS }
