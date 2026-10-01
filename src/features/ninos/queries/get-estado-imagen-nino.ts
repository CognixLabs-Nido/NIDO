import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface EstadoImagenNino {
  /** El niño puede aparecer en fotos (flag derivado de los consentimientos vigentes). */
  visible: boolean
  /** Hay algún consentimiento de imagen vigente para el niño (de cualquier tutor). */
  hayVigente: boolean
  /** El usuario actual tiene un consentimiento de imagen vigente para el niño. */
  miVigente: boolean
}

/**
 * Estado de la autorización de imagen de un niño visto por su tutor (portal de familia).
 * `visible` y `hayVigente` difieren con doble consentimiento: un tutor autorizó y falta el
 * otro principal → hay consentimiento vigente pero el niño sigue oculto.
 */
export async function getEstadoImagenNino(
  ninoId: string,
  visible: boolean,
  userId: string
): Promise<EstadoImagenNino> {
  const supabase = await createClient()
  const [{ data: hayVigente }, { data: mio }] = await Promise.all([
    supabase.rpc('existe_consentimiento_imagen', { p_nino_id: ninoId }),
    supabase
      .from('consentimientos')
      .select('id')
      .eq('usuario_id', userId)
      .eq('nino_id', ninoId)
      .eq('tipo', 'imagen')
      .is('revocado_en', null)
      .limit(1)
      .maybeSingle(),
  ])
  return { visible, hayVigente: hayVigente === true, miVigente: mio !== null }
}
