import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { leerTutoresDeNino } from '@/features/alta/lib/tutores-familia'
import { sendInvitation } from '@/features/auth/actions/send-invitation'
import { idiomaCorreoEnum, type IdiomaCorreo } from '@/features/auth/schemas/invitation'
import { logger } from '@/shared/lib/logger'
import { lecturaFallidaTrasEscritura } from '@/shared/lib/tras-escritura'
import type { Database } from '@/types/db'
import { LecturaFallida } from '@/shared/lib/lectura-fallida'

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
 * **Best-effort e idempotente**: si no hay tutor 2, si no dejó email, o si no hay nada que invitar,
 * no hace nada (`no_hacia_falta`). `sendInvitation` ya deduplica invitaciones abiertas por (email,
 * centro, rol, niño), así que reactivar no genera duplicados. Un fallo aquí NO aborta la activación
 * (el alta ya quedó validada), pero ya no es silencioso (censo C, 2026-11-25): devuelve `no_enviada` y
 * la pantalla dice «Guardado; no se ha podido enviar el aviso o el correo», para que se reenvíe desde
 * Altas en proceso.
 */
export async function invitarTutor2AlValidar(
  supabase: Client,
  ninoId: string
): Promise<'enviada' | 'no_hacia_falta' | 'no_enviada'> {
  try {
    // centro del niño (matriculas no lleva centro_id).
    const { data: nino, error: errorLectura } = await supabase
      .from('ninos')
      .select('centro_id')
      .eq('id', ninoId)
      .is('deleted_at', null)
      .maybeSingle()
    if (errorLectura) throw new LecturaFallida('invitarTutor2AlValidar', errorLectura)
    if (!nino) return 'no_hacia_falta'

    // Email del tutor 2 capturado en el wizard, desde el perfil COMPARTIDO `familia_tutores`
    // (F-2b-3): el segundo_tutor de la familia del niño.
    // Censo C (clase 1): con la lectura caída esto era «no hay segundo tutor» → `no_hacia_falta`, y la
    // activación decía «guardado» sin el aviso de que la invitación no salió (lo contrario de lo que dijo el
    // cuerpo del PR A). Ahora lanza, y el catch de abajo contesta `no_enviada`.
    const lecturaTutores = await leerTutoresDeNino(supabase, ninoId)
    if (!lecturaTutores.leidos)
      throw new LecturaFallida('invitarTutor2AlValidar', lecturaTutores.error)
    const { tutores } = lecturaTutores
    const tutor2 = tutores.find((t) => t.tipo_vinculo === 'tutor_legal_secundario')
    const email = tutor2?.email?.trim()
    if (!email) return 'no_hacia_falta'

    // ¿El tutor 2 ya tiene cuenta en la familia? → lo vincula la RPC, nada que invitar.
    if (tutor2?.usuario_id) return 'no_hacia_falta'

    // ¿Ya está vinculado a este niño (p. ej. aceptó por B8, que no enlaza el perfil)? → nada.
    const { data: vinculo, error: errorLectura2 } = await supabase
      .from('vinculos_familiares')
      .select('id')
      .eq('nino_id', ninoId)
      .eq('tipo_vinculo', 'tutor_legal_secundario')
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    if (errorLectura2) throw new LecturaFallida('invitarTutor2AlValidar', errorLectura2)
    if (vinculo) return 'no_hacia_falta'

    // ¿Ya tiene una invitación abierta (de otro hijo de la familia)? → al aceptarla queda
    // vinculado a todos los hijos; no se manda otra.
    const { data: abierta, error: errorLectura3 } = await supabase
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
    if (errorLectura3) throw new LecturaFallida('invitarTutor2AlValidar', errorLectura3)
    if (abierta) return 'no_hacia_falta'

    const idioma = await idiomaDelTitular(supabase, tutores)

    const r = await sendInvitation({
      email,
      rolObjetivo: 'tutor_legal',
      centroId: nino.centro_id,
      ninoId,
      tipoVinculo: 'tutor_legal_secundario',
      idioma,
    })
    if (!r.success) {
      logger.warn('invitarTutor2AlValidar', r.error)
      return 'no_enviada'
    }
    return 'enviada'
  } catch (e) {
    logger.warn('invitarTutor2AlValidar', e instanceof Error ? e.message : 'desconocido')
    return 'no_enviada'
  }
}

/**
 * Idioma del correo al segundo tutor: el del tutor principal de la familia (ya eligió el suyo al
 * aceptar su invitación). Si no se puede leer, castellano. Lo usan la invitación al validar y el
 * reenvío de «Altas en proceso».
 */
export async function idiomaDelTitular(
  supabase: Client,
  tutores: { tipo_vinculo: string; usuario_id: string | null }[]
): Promise<IdiomaCorreo> {
  const principal = tutores.find((t) => t.tipo_vinculo === 'tutor_legal_principal')
  if (!principal?.usuario_id) return 'es'
  const { data: perfil, error } = await supabase
    .from('usuarios')
    .select('idioma_preferido')
    .eq('id', principal.usuario_id)
    .maybeSingle()
  // Se lee después de escribir (validar el alta, o cancelar las invitaciones anteriores al reenviar):
  // sin el idioma, castellano, como dice este contrato, y el fallo a Sentry (censo C, 2026-11-25).
  if (error) {
    lecturaFallidaTrasEscritura('idiomaDelTitular', error)
    return 'es'
  }
  const leido = idiomaCorreoEnum.safeParse(perfil?.idioma_preferido)
  return leido.success ? leido.data : 'es'
}
