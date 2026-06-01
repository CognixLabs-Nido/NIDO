import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import type { RecordatorioListItem } from '../types'

// Embebemos nombre del niño y del autor vía las FK. La RLS de `ninos`/`usuarios`
// se aplica también al embed — si el caller no puede leer el recurso, viene
// null y la UI cae a un fallback. La RLS de `recordatorios` ya filtra qué filas
// entran (por destino y rol).
const SELECT_LIST = `
  id, destinatario, nino_id, aula_id, titulo, descripcion, vencimiento,
  completado_en, completado_por, erroneo, creado_por, created_at,
  nino:ninos!recordatorios_nino_id_fkey ( nombre ),
  aula:aulas!recordatorios_aula_id_fkey ( nombre ),
  destinatario_usuario:usuarios!recordatorios_usuario_destinatario_id_fkey ( nombre_completo ),
  autor:usuarios!recordatorios_creado_por_fkey ( nombre_completo )
` as const

type ListRow = {
  id: string
  destinatario: Database['public']['Enums']['recordatorio_destinatario']
  nino_id: string | null
  aula_id: string | null
  titulo: string
  descripcion: string | null
  vencimiento: string | null
  completado_en: string | null
  completado_por: string | null
  erroneo: boolean
  creado_por: string
  created_at: string
  nino: { nombre: string } | null
  aula: { nombre: string } | null
  destinatario_usuario: { nombre_completo: string } | null
  autor: { nombre_completo: string } | null
}

function mapRow(r: ListRow, userId: string): RecordatorioListItem {
  return {
    id: r.id,
    destinatario: r.destinatario,
    nino_id: r.nino_id,
    nino_nombre: r.nino?.nombre ?? null,
    aula_id: r.aula_id,
    aula_nombre: r.aula?.nombre ?? null,
    usuario_destinatario_nombre: r.destinatario_usuario?.nombre_completo ?? null,
    titulo: r.titulo,
    descripcion: r.descripcion,
    vencimiento: r.vencimiento,
    completado_en: r.completado_en,
    completado_por: r.completado_por,
    erroneo: r.erroneo,
    creado_por: r.creado_por,
    autor_nombre: r.autor?.nombre_completo ?? null,
    created_at: r.created_at,
    es_propio: r.creado_por === userId,
  }
}

/**
 * Recordatorios PENDIENTES visibles para el usuario actual (no completados, no
 * anulados). La RLS de SELECT determina la visibilidad por destino y rol:
 * tutor → familia/equipo de sus hijos + sus personales; profe → de su aula;
 * admin → del centro; más los `direccion` que cada uno creó.
 *
 * Orden: por vencimiento ascendente (los sin fecha al final), luego por fecha
 * de creación descendente. El índice parcial `idx_recordatorios_pendientes`
 * cubre el filtro.
 */
export async function getRecordatoriosPendientesDeUsuario(): Promise<RecordatorioListItem[]> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return []
  return fetchLista(supabase, userId, 'pendientes')
}

/**
 * Recordatorios COMPLETADOS visibles para el usuario (limitados a `limit`,
 * por defecto 50, los más recientes primero). Excluye anulados.
 */
export async function getRecordatoriosCompletadosDeUsuario(
  limit = 50
): Promise<RecordatorioListItem[]> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return []
  return fetchLista(supabase, userId, 'completados', limit)
}

async function fetchLista(
  supabase: SupabaseClient<Database>,
  userId: string,
  modo: 'pendientes' | 'completados',
  limit = 200
): Promise<RecordatorioListItem[]> {
  let query = supabase.from('recordatorios').select(SELECT_LIST).eq('erroneo', false)

  if (modo === 'pendientes') {
    query = query
      .is('completado_en', null)
      .order('vencimiento', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit)
  } else {
    query = query
      .not('completado_en', 'is', null)
      .order('completado_en', { ascending: false })
      .limit(limit)
  }

  const { data, error } = await query
  if (error) {
    logger.warn(`getRecordatorios(${modo})`, error.message)
    return []
  }
  return ((data ?? []) as unknown as ListRow[]).map((r) => mapRow(r, userId))
}
