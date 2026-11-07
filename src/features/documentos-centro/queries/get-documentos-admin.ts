import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  contarFirmas,
  firmantesPorVersion,
  type CursoDeLaPantalla,
  type ListaAdmin,
  leerListaAdmin,
} from '../lib/pantalla'

export interface PantallaDocumentos {
  lista: ListaAdmin
  cursos: CursoDeLaPantalla[]
  /** Cuántas firmas tiene cada versión, de las que la admin puede leer (3b). */
  firmas: Record<string, number>
  /** Qué niños firmaron cada versión, para decir a cuántos se pediría volver a firmar (4d). */
  firmantes: Record<string, string[]>
}

/**
 * Lo que enseña la pantalla de la admin (3c), con su sesión. La lista sale de
 * `documentos_centro_admin` (3a), que pasa por la puerta de la admin del centro; los cursos, de
 * `cursos_academicos`; las firmas, de `firmas_documentos_centro`, que la Dirección lee (3b): la
 * versión y el niño. Si una lectura falla, no hay pantalla (`null`): una lista vacía diría «no hay
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
    supabase
      .from('firmas_documentos_centro')
      .select('version_id, nino_id')
      .eq('centro_id', centroId),
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
    firmantes: firmantesPorVersion(firmas.data ?? []),
  }
}
