import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { esFormaGastos, type FormaGastos } from '../lib/gastos'

export interface CursoGastos {
  id: string
  nombre: string
  estado: string
  /** El importe que fija el centro para el curso; `null` = no los cobra ese curso. */
  importeCentimos: number | null
}

export interface PendienteGastos {
  ninoId: string
  nombre: string
  cursoId: string
  cursoNombre: string
  importe: number
  forma: FormaGastos | null
  conJustificante: boolean
  /** La matrícula sigue `pendiente`: la familia aún no ha cerrado el alta. */
  enAlta: boolean
}

export interface GastosCentro {
  cursos: CursoGastos[]
  pendientes: PendienteGastos[]
}

/**
 * Fase 9 — lo de Cuotas: el importe de cada curso no cerrado del centro y los que faltan por cobrar
 * (`gastos_gestion_pendientes`). Con la sesión de Dirección (la base mira `es_admin`). Si una lectura
 * falla, `null`: una lista vacía diría «no falta nadie».
 */
export async function getGastosCentro(centroId: string): Promise<GastosCentro | null> {
  const supabase = await createClient()
  const [cursosR, importesR, pendientesR] = await Promise.all([
    supabase
      .from('cursos_academicos')
      .select('id, nombre, estado, fecha_inicio')
      .eq('centro_id', centroId)
      .neq('estado', 'cerrado')
      .is('deleted_at', null)
      .order('fecha_inicio', { ascending: true }),
    supabase
      .from('gastos_gestion_curso')
      .select('curso_academico_id, importe_centimos')
      .eq('centro_id', centroId),
    supabase.rpc('gastos_gestion_pendientes', { p_centro_id: centroId }),
  ])
  if (cursosR.error || importesR.error || pendientesR.error) {
    logger.warn(
      'getGastosCentro',
      cursosR.error?.code ?? importesR.error?.code ?? pendientesR.error?.code ?? 'sin_codigo'
    )
    return null
  }
  const importe = new Map(
    (importesR.data ?? []).map((g) => [g.curso_academico_id, g.importe_centimos])
  )
  return {
    cursos: (cursosR.data ?? []).map((k) => ({
      id: k.id,
      nombre: k.nombre,
      estado: k.estado,
      importeCentimos: importe.get(k.id) ?? null,
    })),
    pendientes: (pendientesR.data ?? []).flatMap((p) =>
      p.nino_id && p.curso_academico_id && p.importe !== null
        ? [
            {
              ninoId: p.nino_id,
              nombre: [p.nombre, p.apellidos].filter(Boolean).join(' '),
              cursoId: p.curso_academico_id,
              cursoNombre: p.curso_nombre ?? '',
              importe: p.importe,
              forma: esFormaGastos(p.forma) ? p.forma : null,
              conJustificante: p.con_justificante === true,
              enAlta: p.matricula_pendiente === true,
            },
          ]
        : []
    ),
  }
}
