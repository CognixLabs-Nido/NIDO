import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']
type MetodoPago = Database['public']['Enums']['metodo_pago']

export interface ReciboFamiliaItem {
  id: string
  anio: number
  mes: number
  estado: EstadoRecibo
  metodo: MetodoPago | null
  totalCentimos: number
  esEsporadico: boolean
  conceptoEsporadico: string | null
  /** Recibo de re-giro (ligado a un devuelto): lo señalamos a la familia. */
  esRegiro: boolean
  createdAt: string
}

export interface RecibosFamiliaNino {
  ninoId: string
  nombre: string
  recibos: ReciboFamiliaItem[]
}

/**
 * Recibos PASADOS del/los hijo(s) del tutor legal, agrupados por niño y ordenados por
 * período descendente (más reciente primero). Solo lectura. La RLS de `recibos` ya
 * filtra a los hijos del tutor (`es_tutor_legal_de(nino_id)`); no filtramos por usuario
 * aquí. Incluye todos los recibos visibles (regulares, esporádicos y re-giros): cada uno
 * es un cargo real que la familia debe poder consultar.
 */
export async function getRecibosFamilia(): Promise<RecibosFamiliaNino[]> {
  const supabase = await createClient()

  const { data: recibos, error } = await supabase
    .from('recibos')
    .select(
      'id, nino_id, anio, mes, estado, metodo, total_centimos, es_esporadico, concepto_esporadico, devuelto_de_recibo_id, created_at'
    )
    .is('deleted_at', null)
    .order('anio', { ascending: false })
    .order('mes', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    logger.warn('getRecibosFamilia', error.message)
    return []
  }
  if (!recibos || recibos.length === 0) return []

  const ninoIds = [...new Set(recibos.map((r) => r.nino_id))]
  const { data: ninos } = await supabase
    .from('ninos')
    .select('id, nombre, apellidos')
    .in('id', ninoIds)
  const nombrePorNino = new Map(
    (ninos ?? []).map((n) => [n.id, [n.nombre, n.apellidos].filter(Boolean).join(' ')])
  )

  const grupos = new Map<string, RecibosFamiliaNino>()
  for (const r of recibos) {
    let grupo = grupos.get(r.nino_id)
    if (!grupo) {
      grupo = { ninoId: r.nino_id, nombre: nombrePorNino.get(r.nino_id) ?? '', recibos: [] }
      grupos.set(r.nino_id, grupo)
    }
    grupo.recibos.push({
      id: r.id,
      anio: r.anio,
      mes: r.mes,
      estado: r.estado,
      metodo: r.metodo,
      totalCentimos: r.total_centimos,
      esEsporadico: r.es_esporadico,
      conceptoEsporadico: r.concepto_esporadico,
      esRegiro: r.devuelto_de_recibo_id != null,
      createdAt: r.created_at,
    })
  }

  // Orden estable de niños por nombre para una lista determinista.
  return [...grupos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
}

/** Todos los ids de recibos visibles (para marcarlos como vistos al abrir la lista). */
export function idsDeRecibos(grupos: RecibosFamiliaNino[]): string[] {
  return grupos.flatMap((g) => g.recibos.map((r) => r.id))
}
