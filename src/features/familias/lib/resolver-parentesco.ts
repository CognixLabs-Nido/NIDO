import type { Database } from '@/types/database'

export type Parentesco = Database['public']['Enums']['parentesco']

export interface VinculoParentesco {
  parentesco: Parentesco
  descripcion_parentesco: string | null
}

export type ResolucionParentesco =
  | { ok: true; parentesco: Parentesco; descripcionParentesco: string }
  | { ok: false }

/**
 * F-2b-4-2 (D-4 punto 3) — resuelve el parentesco del vínculo del hijo NUEVO al añadirlo
 * a una familia existente, con estrategia HÍBRIDA:
 *
 *  1. **Hereda** del vínculo previo del titular cuando exista (sin fricción, sin preguntar).
 *     El `parentesco` es la relación del ADULTO con el niño (madre/padre/abuela…), consistente
 *     entre sus hijos → el vínculo existente es la fuente de verdad. La query del action lee
 *     también los vínculos **soft-borrados** (familia reactivada, F-2b-4-1): un vínculo archivado
 *     sigue diciendo la verdad → así el caso de reactivación hereda sin preguntar.
 *  2. Si NO hay herencia, usa el parentesco **tecleado en el diálogo** (revelado solo en ese caso).
 *  3. Si no hay ninguno de los dos, **falla** — nunca se persiste `'otro'` por defecto (ese
 *     fallback silencioso ocultaba una inconsistencia en vez de exponerla).
 */
export function resolverParentesco(
  vinculoPrevio: VinculoParentesco | null,
  parentescoForm: Parentesco | undefined,
  descripcionForm: string | null | undefined
): ResolucionParentesco {
  if (vinculoPrevio) {
    return {
      ok: true,
      parentesco: vinculoPrevio.parentesco,
      descripcionParentesco: vinculoPrevio.descripcion_parentesco ?? '',
    }
  }
  if (parentescoForm) {
    return {
      ok: true,
      parentesco: parentescoForm,
      descripcionParentesco: descripcionForm ?? '',
    }
  }
  return { ok: false }
}
