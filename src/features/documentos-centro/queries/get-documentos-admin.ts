import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  contarFirmas,
  type CursoDeLaPantalla,
  type ListaAdmin,
  leerListaAdmin,
} from '../lib/pantalla'

export interface PantallaDocumentos {
  lista: ListaAdmin
  cursos: CursoDeLaPantalla[]
  /** Cuántas firmas tiene cada versión, de las que la admin puede leer (1b). */
  firmas: Record<string, number>
}

/**
 * Lo que enseña la pantalla de la admin (1c), con su sesión. La lista sale de
 * `documentos_centro_admin` (1a), que pasa por la puerta de la admin del centro; los cursos, de
 * `cursos_academicos`; las firmas, de `firmas_documentos_centro`, que la Dirección lee (1b), solo
 * `version_id`. Si una lectura falla, no hay pantalla (`null`): una lista vacía diría «no hay
 * documentos» y unas firmas vacías ofrecerían borrar versiones firmadas.
 */
export async function getDocumentosAdmin(centroId: string): Promise<PantallaDocumentos | null> {
  const supabase = await createClient()
  const [lista, cursos, firmas] = await Promise.all([
    supabase.rpc('documentos_centro_admin', { p_centro_id: centroId }),
    supabase
      .from('cursos_academicos')
      .select('id, nombre, estado')
      .eq('centro_id', centroId)
      .is('deleted_at', null)
      .order('fecha_inicio', { ascending: false }),
    supabase.from('firmas_documentos_centro').select('version_id').eq('centro_id', centroId),
  ])
  if (lista.error || cursos.error || firmas.error) {
    logger.warn(
      'documentos del centro: la pantalla',
      lista.error?.message ?? cursos.error?.message ?? firmas.error?.message
    )
    return null
  }
  return {
    lista: leerListaAdmin(lista.data),
    cursos: (cursos.data ?? []) as CursoDeLaPantalla[],
    firmas: contarFirmas(firmas.data ?? []),
  }
}
