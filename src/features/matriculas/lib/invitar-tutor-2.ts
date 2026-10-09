import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { leerTutoresDeNino } from '@/features/alta/lib/tutores-familia'
import { sendInvitation } from '@/features/auth/actions/send-invitation'
import { idiomaCorreoEnum, type IdiomaCorreo } from '@/features/auth/schemas/invitation'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

/**
 * F11-G-3 (decisión D-a) — al VALIDAR el alta (matrícula → 'activa'), la dirección dispara
 * la invitación al **tutor 2** con el email que metió el tutor 1 en el wizard
 * (`familia_tutores` rol `segundo_tutor`, F-2b-3). Plantilla neutral de invitación
 * (`rol_objetivo='tutor_legal'`); el tutor 2 pone su contraseña al aceptar y queda vinculado
 * como `tutor_legal_secundario`.
 *
 * Solo invita al tutor 2 que **aún no tiene cuenta** en la familia (`familia_tutores.usuario_id`
 * NULL). Si ya la tiene, no hay nada que invitar: la RPC `crear_o_anadir_a_familia` lo vincula
 * a cada hermano nuevo (alta del 2.º hijo); invitarle fallaba con `email_exists` y dejaba una
 * invitación colgada. Tampoco reinvita si ya tiene una invitación abierta para otro hijo de la
 * familia: al aceptarla queda vinculado a TODOS los hijos (`accept-invitation`).
 *
 * **Best-effort, idempotente y silencioso**: si no hay tutor 2, si no dejó email, o si no hay
 * nada que invitar, no hace nada. `sendInvitation` ya deduplica invitaciones abiertas
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

    // Email del tutor 2 capturado en el wizard, desde el perfil COMPARTIDO `familia_tutores`
    // (F-2b-3): el segundo_tutor de la familia del niño.
    const { tutores } = await leerTutoresDeNino(supabase, ninoId)
    const tutor2 = tutores.find((t) => t.tipo_vinculo === 'tutor_legal_secundario')
    const email = tutor2?.email?.trim()
    if (!email) return

    // ¿El tutor 2 ya tiene cuenta en la familia? → lo vincula la RPC, nada que invitar.
    if (tutor2?.usuario_id) return

    // ¿Ya está vinculado a este niño (p. ej. aceptó por B8, que no enlaza el perfil)? → nada.
    const { data: vinculo } = await supabase
      .from('vinculos_familiares')
      .select('id')
      .eq('nino_id', ninoId)
      .eq('tipo_vinculo', 'tutor_legal_secundario')
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    if (vinculo) return

    // ¿Ya tiene una invitación abierta (de otro hijo de la familia)? → al aceptarla queda
    // vinculado a todos los hijos; no se manda otra.
    const { data: abierta } = await supabase
      .from('invitaciones')
      .select('id')
      .eq('email', email)
      .eq('centro_id', nino.centro_id)
      .eq('rol_objetivo', 'tutor_legal')
      .is('accepted_at', null)
      .is('rejected_at', null)
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle()
    if (abierta) return

    // Idioma del correo: el del tutor principal de la familia (ya eligió el suyo al aceptar su
    // invitación). Si no se puede leer, castellano.
    const principal = tutores.find((t) => t.tipo_vinculo === 'tutor_legal_principal')
    let idioma: IdiomaCorreo = 'es'
    if (principal?.usuario_id) {
      const { data: perfil } = await supabase
        .from('usuarios')
        .select('idioma_preferido')
        .eq('id', principal.usuario_id)
        .maybeSingle()
      const leido = idiomaCorreoEnum.safeParse(perfil?.idioma_preferido)
      if (leido.success) idioma = leido.data
    }

    const r = await sendInvitation({
      email,
      rolObjetivo: 'tutor_legal',
      centroId: nino.centro_id,
      ninoId,
      tipoVinculo: 'tutor_legal_secundario',
      idioma,
    })
    if (!r.success) logger.warn('invitarTutor2AlValidar', r.error)
  } catch (e) {
    logger.warn('invitarTutor2AlValidar', e instanceof Error ? e.message : 'desconocido')
  }
}
