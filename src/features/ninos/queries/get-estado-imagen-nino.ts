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
}

/**
 * Estado de la autorización de imagen de un niño visto por su tutor (portal de familia).
 *
 * Cada tutor responde por sí (decisión del responsable del 2026-11-17): `miVigente` y `miNo` son las
 * respuestas de quien mira, leídas de sus propias filas. El «no» del otro tutor no se ve desde aquí
 * (la RLS solo deja leer las propias): por eso, con «sí» propio y el niño oculto, la pantalla dice que
 * falta el otro tutor o que no la autoriza, sin decir cuál de las dos.
 *
 * Si la respuesta propia no se puede leer, lanza: sin ella no se sabe qué botones ofrecer.
 */
export async function getEstadoImagenNino(
  ninoId: string,
  visible: boolean,
  userId: string
): Promise<EstadoImagenNino> {
  const supabase = await createClient()
  const [{ data: hayVigente }, mia] = await Promise.all([
    supabase.rpc('existe_consentimiento_imagen', { p_nino_id: ninoId }),
    leerRespuestaImagen(supabase, ninoId, userId),
  ])
  if (!mia.ok) throw new Error('getEstadoImagenNino: la respuesta propia no se lee')
  return {
    visible,
    hayVigente: hayVigente === true,
    miVigente: mia.respuesta === 'si',
    miNo: mia.respuesta === 'no',
  }
}
