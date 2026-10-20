'use server'

import { revalidatePath } from 'next/cache'

import { sendInvitation } from '@/features/auth/actions/send-invitation'
import { llamarGoTrue } from '@/features/auth/lib/llamar-gotrue'
import { esAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { permisosDefault } from '@/features/vinculos/schemas/vinculo'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Json } from '@/types/database'

import { tutorDeEsteCentro } from '../lib/resolver-tutor-email'
import { vincularHijoATutorExistente } from '../lib/vincular-hijo-tutor-existente'
import { invitarAlAltaSchema, type InvitarAlAltaInput } from '../schemas/lista-espera'
import { fail, ok, type ActionResult } from '../../centros/types'

/** Retorno JSON de la RPC `crear_o_anadir_a_familia` (F-2b-1). */
type ResultadoCrearFamilia = {
  resultado: 'familia_creada' | 'nino_anadido' | 'colision'
  familia_id: string | null
  nino_id: string | null
  matricula_id?: string | null
  colision_info: { motivo: string; nombre_existente: string | null } | null
}

/**
 * Éxito de `invitarAlAlta`: alta creada + invitación enviada (`ok`), o COLISIÓN detectada
 * por la RPC (email ya en el centro con otro perfil) → la UI avisa a Dirección y NO invita.
 */
export type InvitarAlAltaOk =
  | { resultado: 'ok'; ninoId: string; invitationId: string }
  | { resultado: 'colision'; nombreExistente: string | null }
  // FIX A: el tutor YA tenía familia en este centro → el hijo entró en ella directamente (sin
  // email ni invitación: ya tiene acceso). La UI lo distingue del alta invitada.
  | { resultado: 'vinculado'; ninoId: string }

/**
 * F11-H-3 "invitar al alta" (F-2b-2b: cableado a la RPC de familia). Promociona un prospecto
 * de la lista de espera a alta real, fijando ya su aula del curso activo, y dispara la
 * invitación por email. El alta (familia + perfil `familia_tutores` + niño + matrícula
 * pendiente) la crea de forma ATÓMICA la RPC `crear_o_anadir_a_familia`; aquí ya NO hay
 * INSERT manuales de niño/matrícula/perfil ni rollback en cascada.
 *
 * `p_usuario_id = NULL` A PROPÓSITO: al invitar la cuenta es un STUB sin roles
 * (`inviteUserByEmail`); pasar su id haría que la RPC creara el `roles_usuario`, y entonces
 * `clasificarCuenta` marcaría la cuenta como 'real' → la página de invitación mandaría al
 * tutor a "ya tienes cuenta" en vez del formulario de contraseña. Con NULL, la RPC OMITE
 * rol/vínculo (su guard `IF p_usuario_id IS NOT NULL`) y deja el perfil `familia_tutores`
 * con `usuario_id` NULL; al ACEPTAR se rellena (backfill) con el id definitivo de la cuenta.
 * Lo mismo para una cuenta que YA existe en otro centro: se le invita, acepta desde su perfil y
 * ahí se enlaza (PR 1 de la Fase 4).
 *
 * La RPC va por el cliente AUTENTICADO: su gate `es_admin(auth.uid(), p_centro_id)` autoriza
 * (además del gate admin explícito de abajo). `p_centro_id` es server-derivado, no falseable.
 */
export async function invitarAlAlta(
  input: InvitarAlAltaInput,
  locale: string = 'es'
): Promise<ActionResult<InvitarAlAltaOk>> {
  const parsed = invitarAlAltaSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'listaEspera.validation.invalid')

  const supabase = await createClient()
  const { data: userData, indisponible: authIndisponible } = await llamarGoTrue('getUser', () =>
    supabase.auth.getUser()
  )
  if (authIndisponible) return fail('auth.invitation.errors.servicio_cuentas_no_disponible')
  if (!userData?.user) return fail('auth.invitation.errors.unauthenticated')

  // Prospecto primero: SU centro es el de la acción, no el centro activo de la cookie (una
  // pestaña de otro centro actúa sobre el prospecto que enseña). La RLS de `lista_espera`
  // solo deja leer a Dirección los de sus centros.
  const { data: prospecto } = await supabase
    .from('lista_espera')
    .select(
      'id, centro_id, nombre_nino, apellidos_nino, fecha_nacimiento, email_tutor, tutor_usuario_id, estado'
    )
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (!prospecto) return fail('listaEspera.errors.no_encontrado')
  const centroId = prospecto.centro_id

  // Gate admin del centro del prospecto (defensa en profundidad; la RPC lo revalida server-side).
  if (!(await esAdminEn(supabase, userData.user.id, centroId)))
    return fail('auth.invitation.errors.forbidden')

  // Curso activo del centro (autoritativo server-side; la matrícula va contra él). La RPC
  // lo revalida, pero se comprueba aquí para dar errores de UX específicos.
  const { data: cursoActivoId } = await supabase.rpc('curso_activo_de_centro', {
    p_centro_id: centroId,
  })
  if (!cursoActivoId) return fail('listaEspera.errors.sin_curso_activo')

  // El aula elegida debe estar configurada en el curso activo (aulas_curso).
  const { data: aulaCurso } = await supabase
    .from('aulas_curso')
    .select('aula_id')
    .eq('aula_id', parsed.data.aulaId)
    .eq('curso_academico_id', cursoActivoId)
    .maybeSingle()
  if (!aulaCurso) return fail('listaEspera.errors.aula_invalida')

  // Debe estar en espera y tener email.
  if (prospecto.estado !== 'en_espera') return fail('listaEspera.errors.no_en_espera')
  // D1 (U-2): un prospecto de 2.º hijo trae la cuenta del tutor ya resuelta. Ese caso NO
  // manda invitación (el tutor ya tiene acceso), así que el email deja de ser obligatorio;
  // para el resto sigue siéndolo, porque es la dirección a la que se invita.
  const tutorPrevioId = prospecto.tutor_usuario_id
  if (!tutorPrevioId && !prospecto.email_tutor) return fail('listaEspera.errors.sin_email')
  // Const para que el narrowing (no-null) sobreviva a los `await` posteriores.
  const emailTutor = prospecto.email_tutor

  // `fecha_nacimiento` es obligatoria para crear el niño (la RPC la exige NOT NULL).
  // Const para que el narrowing sobreviva a los `await` posteriores.
  const fechaNacimiento = prospecto.fecha_nacimiento
  if (!fechaNacimiento) return fail('listaEspera.errors.sin_fecha_nacimiento')

  // ¿Es el 2.º hijo de una familia de ESTE centro? Entonces se vincula a esa cuenta sin invitar
  // (ya aceptó este centro). Cualquier otra cuenta —de otro centro, del personal, el
  // superusuario— se INVITA y acepta desde su perfil (PR 1 de la Fase 4): entre centros nadie
  // entra sin aceptar. La regla vive en `tutorDeEsteCentro` (la misma que `completarEnDireccion`)
  // y la exigen también la RPC y el trigger de `lista_espera`. Va ANTES de cualquier escritura.
  const service = createServiceRoleClient()
  const tutorExistenteId = await tutorDeEsteCentro(service, {
    tutorPrevioId,
    email: emailTutor,
    centroId,
  })
  if (tutorExistenteId === undefined)
    return fail('auth.invitation.errors.servicio_cuentas_no_disponible')
  if (tutorExistenteId) {
    // FIX A — el tutor YA tiene familia en este centro: el nuevo hijo entra en ella SIN email ni
    // invitación (ya tiene acceso) + push. El parentesco se hereda del vínculo previo del tutor
    // (p. ej. su 1.er hijo); si no hay herencia, vale el que pidió el diálogo (solo lo pide en
    // ese caso) y, si tampoco viene, falla con `parentesco_requerido` → el diálogo lo revela.
    const vinc = await vincularHijoATutorExistente(service, supabase, {
      tutorUsuarioId: tutorExistenteId,
      centroId,
      aulaId: parsed.data.aulaId,
      nombreNino: prospecto.nombre_nino,
      apellidosNino: prospecto.apellidos_nino ?? '',
      fechaNacimiento,
      parentescoForm: parsed.data.parentesco,
      descripcionParentescoForm: parsed.data.descripcionParentesco ?? null,
      locale,
    })
    if (!vinc.success) return fail(vinc.error)

    // U-4: se guarda además el `nino_id` creado → la lista puede pintar el estado real de la
    // matrícula y ofrecer "Reanudar alta". Sin él, el prospecto se quedaba mudo tras promover.
    const { error: estadoErr } = await supabase
      .from('lista_espera')
      .update({ estado: 'invitado', nino_id: vinc.data.ninoId })
      .eq('id', prospecto.id)
    if (estadoErr) logger.warn('invitarAlAlta estado update (vinculado)', estadoErr.message)

    revalidatePath('/[locale]/admin/admisiones', 'page')
    return ok({ resultado: 'vinculado', ninoId: vinc.data.ninoId })
  }

  // Sin tutor existente → flujo de invitación por email, que SÍ lo exige (el guard de arriba
  // solo lo perdona cuando hay `tutor_usuario_id`). Re-chequeo para el narrowing.
  if (!emailTutor) return fail('listaEspera.errors.sin_email')

  // 1. RPC transaccional con `p_usuario_id = NULL` (ver cabecera): crea familia + perfil
  //    `familia_tutores`(usuario_id NULL) + niño(familia_id) + matrícula pendiente, y OMITE
  //    rol/vínculo. `p_tutor_nombre_completo`/`p_parentesco`/`p_permisos` van vacíos: no se
  //    usan con `usuario_id` NULL (el vínculo se crea al ACEPTAR) y el nombre del tutor no
  //    existe en `lista_espera` — se captura y persiste (backfill) al aceptar.
  const { data: rpcData, error: rpcError } = await supabase.rpc('crear_o_anadir_a_familia', {
    p_nombre_nino: prospecto.nombre_nino,
    p_apellidos_nino: prospecto.apellidos_nino ?? '',
    p_fecha_nacimiento: fechaNacimiento,
    p_centro_id: centroId,
    p_aula_id: parsed.data.aulaId,
    p_tutor_email: emailTutor,
    p_tutor_nombre_completo: '',
    p_parentesco: '',
    p_descripcion_parentesco: '',
    // NULL = modo Invitar (ver cabecera). Los tipos generados tipan los args de RPC como
    // no-nullables aunque el SQL acepte NULL → cast localizado.
    p_usuario_id: null as unknown as string,
    p_permisos: permisosDefault('tutor_legal_principal') as Json,
  })
  if (rpcError) {
    logger.warn('invitarAlAlta rpc', rpcError.message)
    return fail('listaEspera.errors.alta_fallo')
  }

  const res = rpcData as ResultadoCrearFamilia
  if (res.resultado === 'colision') {
    // Email ya en el centro con OTRO perfil → avisar a Dirección; NO invitar (patrón PR-A).
    return ok({
      resultado: 'colision',
      nombreExistente: res.colision_info?.nombre_existente ?? null,
    })
  }

  const ninoId = res.nino_id as string

  // 2. Invitación: reusa `sendInvitation` (stub GoTrue `inviteUserByEmail` + fila
  //    `invitaciones`, dedupe nino_id-aware; a una cuenta que ya existe le llega el aviso por
  //    Resend). El alta ya está creada por la RPC.
  const inv = await sendInvitation(
    {
      email: emailTutor,
      rolObjetivo: 'tutor_legal',
      centroId,
      ninoId,
      tipoVinculo: 'tutor_legal_principal',
      idioma: parsed.data.idioma ?? 'es',
    },
    locale
  )

  // 3. El prospecto sale de la cola, haya salido el correo o no: el alta ya existe, y dejarlo en
  //    espera haría que un segundo «Invitar» creara otro niño. Best-effort: si falla, log.
  const { error: estadoErr } = await supabase
    .from('lista_espera')
    .update({ estado: 'invitado', nino_id: ninoId })
    .eq('id', prospecto.id)
  if (estadoErr) {
    logger.warn('invitarAlAlta estado update', estadoErr.message)
  }

  // El correo no salió: nada sigue en silencio. La directora lee que el alta está creada y la
  // familia no tiene la invitación.
  if (!inv.success) {
    logger.warn('invitarAlAlta: alta creada sin invitación', inv.error)
    revalidatePath('/[locale]/admin/admisiones', 'page')
    return fail('listaEspera.errors.alta_creada_sin_correo')
  }

  revalidatePath('/[locale]/admin/admisiones', 'page')
  return ok({ resultado: 'ok', ninoId, invitationId: inv.data.invitationId })
}
