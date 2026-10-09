import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { RecorridoTramo } from '@/features/ninos/lib/recorrido-familia'

/**
 * F-8 (familia) — recorrido reducido del niño para su tutor LEGAL, por la RPC
 * `get_recorrido_nino_familia` (SECURITY DEFINER, gate `es_tutor_legal_de`). La RPC ya
 * devuelve solo tramos `activa`/`baja` y nunca `motivo_baja`. Si falla (p. ej. quien llama
 * no es tutor legal → 42501), lista vacía.
 */
export async function getRecorridoNinoFamilia(ninoId: string): Promise<RecorridoTramo[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_recorrido_nino_familia', {
    p_nino_id: ninoId,
  })
  if (error) logger.warn('getRecorridoNinoFamilia', error.message)

  return (data ?? []).flatMap((r) =>
    r.estado === 'activa' || r.estado === 'baja'
      ? [
          {
            id: r.matricula_id,
            aula_nombre: r.aula_nombre,
            curso_id: r.curso_id,
            curso_nombre: r.curso_nombre,
            curso_fecha_inicio: r.curso_fecha_inicio,
            fecha_alta: r.fecha_alta,
            fecha_baja: r.fecha_baja ?? null,
            estado: r.estado,
          },
        ]
      : []
  )
}
