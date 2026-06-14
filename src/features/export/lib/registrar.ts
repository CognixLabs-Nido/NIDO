import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import type { SujetoExport } from '../types'

type Client = SupabaseClient<Database>

export interface SujetoRegistrado {
  sujeto_tipo: SujetoExport
  sujeto_id: string
  centro_id: string | null
}

/**
 * Registra el acceso de export (accountability, #7). Se llama con service-role
 * DESPUÉS de que la RLS del solicitante haya autorizado la lectura. Omite sujetos
 * sin centro resoluble (no deberían darse en el flujo normal).
 */
export async function registrarExport(
  service: Client,
  sujetos: SujetoRegistrado[],
  solicitadoPor: string | null
): Promise<void> {
  const payload = sujetos
    .filter((s): s is SujetoRegistrado & { centro_id: string } => Boolean(s.centro_id))
    .map((s) => ({
      sujeto_tipo: s.sujeto_tipo,
      sujeto_id: s.sujeto_id,
      centro_id: s.centro_id,
      solicitado_por: solicitadoPor,
    }))
  if (payload.length === 0) return
  await service.from('export_log').insert(payload)
}
