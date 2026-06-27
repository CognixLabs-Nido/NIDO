import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { sendInvitation } from '@/features/auth/actions/send-invitation'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

/**
 * F11-G-3 (decisión D-a) — al VALIDAR el alta (matrícula → 'activa'), la dirección dispara
 * la invitación al **tutor 2** con el email que metió el tutor 1 en el wizard
 * (`datos_tutor` de vínculo `tutor_legal_secundario`). Plantilla neutral de invitación
 * (`rol_objetivo='tutor_legal'`); el tutor 2 pone su contraseña al aceptar y queda vinculado
 * como `tutor_legal_secundario`.
 *
 * **Best-effort, idempotente y silencioso**: si no hay tutor 2, si no dejó email, o si ya
 * tiene cuenta vinculada, no hace nada. `sendInvitation` ya deduplica invitaciones abiertas
 * por (email, centro, rol, niño), así que reactivar no genera duplicados. Un fallo aquí NO
 * debe abortar la activación (el alta ya quedó validada).
 */
export async function invitarTutor2AlValidar(supabase: Client, ninoId: string): Promise<void> {
  try {
    // centro del niño (matriculas no lleva centro_id).
    const { data: nino } = await supabase
      .from('ninos')
      .select('centro_id')
      .eq('id', ninoId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!nino) return

    // Email del tutor 2 capturado en el wizard.
    const { data: tutor2 } = await supabase
      .from('datos_tutor')
      .select('email')
      .eq('nino_id', ninoId)
      .eq('tipo_vinculo', 'tutor_legal_secundario')
      .is('deleted_at', null)
      .maybeSingle()
    const email = tutor2?.email?.trim()
    if (!email) return

    // ¿El tutor 2 ya tiene cuenta vinculada a este niño? → nada que invitar.
    const { data: vinculo } = await supabase
      .from('vinculos_familiares')
      .select('id')
      .eq('nino_id', ninoId)
      .eq('tipo_vinculo', 'tutor_legal_secundario')
      .is('deleted_at', null)
      .maybeSingle()
    if (vinculo) return

    const r = await sendInvitation({
      email,
      rolObjetivo: 'tutor_legal',
      centroId: nino.centro_id,
      ninoId,
      tipoVinculo: 'tutor_legal_secundario',
    })
    if (!r.success) logger.warn('invitarTutor2AlValidar', r.error)
  } catch (e) {
    logger.warn('invitarTutor2AlValidar', e instanceof Error ? e.message : 'desconocido')
  }
}
