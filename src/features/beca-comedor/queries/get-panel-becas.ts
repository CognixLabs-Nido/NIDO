import 'server-only'

import { getCursoActivo } from '@/features/cursos/queries/get-cursos'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { leerPanelBecas } from '../lib/leer-panel-becas'
import type { PanelBecas } from '../lib/panel-becas'

export interface PanelBecasData {
  /** null sin curso activo (la pestaña ya muestra el aviso) o si la lectura falló. */
  panel: PanelBecas | null
  /** La lectura falló: el panel lo dice en vez de enseñar cifras incompletas. */
  error: boolean
}

/**
 * PR-11 — panel de becas del curso activo: por alumno, qué beca comedor tiene, cuánto, qué se ha
 * descontado y qué queda. Un fallo de lectura no tumba la página de cuotas: el panel lo avisa.
 */
export async function getPanelBecas(centroId: string): Promise<PanelBecasData> {
  const curso = await getCursoActivo(centroId)
  if (!curso) return { panel: null, error: false }
  const supabase = await createClient()
  try {
    return { panel: await leerPanelBecas(supabase, centroId, curso), error: false }
  } catch (e) {
    logger.error('getPanelBecas', e instanceof Error ? e.message : String(e))
    return { panel: null, error: true }
  }
}
