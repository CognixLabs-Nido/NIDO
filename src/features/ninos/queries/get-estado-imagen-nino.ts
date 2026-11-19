import 'server-only'

import { leerRespuestaImagen } from '@/features/alta/lib/respuesta-imagen'
import { createClient } from '@/lib/supabase/server'

export interface EstadoImagenNino {
  /** El niño puede aparecer en fotos (indicador derivado: hay el «sí» que pide y ningún «no»). */
  visible: boolean
  /**
   * Hay un «sí» vigente de algún tutor y ningún «no» vigente de nadie
   * (`existe_consentimiento_imagen`, desde la 10a-2).
   */
  hayVigente: boolean
  /** El usuario actual ha dicho que sí (su «sí» vigente). */
  miVigente: boolean
  /** El usuario actual ha dicho que no (su «no» vigente, fase 10, 10a-2). */
  miNo: boolean
  /** Hay un «no» vigente de otro (`oposicion_imagen`, 10b-3), sin saber de quién. */
  hayOposicion: boolean
}

/**
 * Estado de la autorización de imagen de un niño visto por su tutor (portal de familia).
 *
 * Cada tutor responde por sí (decisión del responsable del 2026-11-17): `miVigente` y `miNo` son las
 * respuestas de quien mira, leídas de sus propias filas. El «no» del otro tutor no se ve (la RLS solo
 * deja leer las propias); si lo hay, sí, sin decir de quién (`oposicion_imagen`, 10b-3): así el que no
 * ha contestado distingue «nadie ha dicho que sí» de «otro se ha opuesto».
 *
 * Si algo no se puede leer, lanza: un fallo no es «no hay» ni «no se opone nadie».
 */
export async function getEstadoImagenNino(
  ninoId: string,
  visible: boolean,
  userId: string
): Promise<EstadoImagenNino> {
  const supabase = await createClient()
  const [vigente, oposicion, mia] = await Promise.all([
    supabase.rpc('existe_consentimiento_imagen', { p_nino_id: ninoId }),
    supabase.rpc('oposicion_imagen', { p_nino_id: ninoId }),
    leerRespuestaImagen(supabase, ninoId, userId),
  ])
  if (!mia.ok) throw new Error('getEstadoImagenNino: la respuesta propia no se lee')
  if (vigente.error) throw new Error('getEstadoImagenNino: existe_consentimiento_imagen no se lee')
  if (oposicion.error) throw new Error('getEstadoImagenNino: oposicion_imagen no se lee')
  return {
    visible,
    hayVigente: vigente.data === true,
    miVigente: mia.respuesta === 'si',
    miNo: mia.respuesta === 'no',
    hayOposicion: oposicion.data === true,
  }
}
