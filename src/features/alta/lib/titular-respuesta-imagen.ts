import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { modoFirmaDocumento } from '@/features/documentos-centro/lib/firmar-documentos'
import type { Database } from '@/types/db'

import { leerTutoresLegalesConCuenta } from './gate-alta'

/**
 * De quién es la respuesta de imagen que se registra en el alta (fase 10b-2). Decisión del
 * responsable del 2026-11-18, literal: «el consentimiento en papel se atribuye AL TUTOR LEGAL QUE
 * FIRMÓ EL PAPEL, nunca a la persona de Dirección. Eso vale para el «sí» y para el «no».»
 *
 * - La familia (vínculo con el niño) contesta por sí: el titular es quien tiene la sesión.
 * - La Dirección en el alta en papel (sin vínculo) anota la del tutor legal que firmó el papel, que
 *   tiene que ser uno de los tutores legales del niño con cuenta. Nunca ella misma, ni nadie que no lo
 *   sea: lo dice aquí, antes, y la base lo frena desde la 10b-3 (N2, `20270129120000`; antes
 *   `otorgar` aceptaba a Dirección, o a cualquiera, como titular).
 *
 * El modo lo decide el servidor (`modoFirmaDocumento`), nunca el navegador.
 */
export type TitularRespuesta =
  | { ok: true; tutor: string; metodo: 'checkbox' | 'presencial' }
  | { ok: false; error: string }

export async function titularRespuestaImagen(
  supabase: SupabaseClient<Database>,
  ninoId: string,
  usuarioId: string,
  tutorPapel: string | undefined
): Promise<TitularRespuesta> {
  const modo = await modoFirmaDocumento(supabase, ninoId, usuarioId)
  if (modo === 'digital') return { ok: true, tutor: usuarioId, metodo: 'checkbox' }
  if (modo !== 'presencial') return { ok: false, error: 'alta.errors.no_autorizado' }
  if (!tutorPapel) return { ok: false, error: 'alta.errors.tutor_papel' }
  const tutores = await leerTutoresLegalesConCuenta(supabase, ninoId)
  if (tutores === null) return { ok: false, error: 'alta.errors.acuse_fallo' }
  if (!tutores.some((t) => t.usuarioId === tutorPapel))
    return { ok: false, error: 'alta.errors.tutor_papel' }
  return { ok: true, tutor: tutorPapel, metodo: 'presencial' }
}
