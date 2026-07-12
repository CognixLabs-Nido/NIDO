'use server'

import { revalidatePath } from 'next/cache'

import { sendInvitation } from '@/features/auth/actions/send-invitation'
import { clasificarCuenta } from '@/features/auth/lib/clasificar-cuenta'
import { llamarGoTrue } from '@/features/auth/lib/llamar-gotrue'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { permisosDefault } from '@/features/vinculos/schemas/vinculo'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Json } from '@/types/database'

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

  const centroId = await getCentroActualId()
  if (!centroId) return fail('listaEspera.errors.sin_centro')

  // Gate admin del centro (defensa en profundidad; la RPC lo revalida server-side).
  const { data: roles } = await supabase
    .from('roles_usuario')
    .select('rol, centro_id')
    .eq('usuario_id', userData.user.id)
    .is('deleted_at', null)
  const isAdmin = roles?.some((r) => r.centro_id === centroId && r.rol === 'admin')
  if (!isAdmin) return fail('auth.invitation.errors.forbidden')

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

  // Prospecto (RLS admin lo acota a su centro). Debe estar en espera y tener email.
  const { data: prospecto } = await supabase
    .from('lista_espera')
    .select('id, centro_id, nombre_nino, apellidos_nino, fecha_nacimiento, email_tutor, estado')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (!prospecto || prospecto.centro_id !== centroId)
    return fail('listaEspera.errors.no_encontrado')
  if (prospecto.estado !== 'en_espera') return fail('listaEspera.errors.no_en_espera')
  if (!prospecto.email_tutor) return fail('listaEspera.errors.sin_email')
  // Const para que el narrowing (no-null) sobreviva a los `await` posteriores.
  const emailTutor = prospecto.email_tutor

  // `fecha_nacimiento` es obligatoria para crear el niño (la RPC la exige NOT NULL).
  // Const para que el narrowing sobreviva a los `await` posteriores.
  const fechaNacimiento = prospecto.fecha_nacimiento
  if (!fechaNacimiento) return fail('listaEspera.errors.sin_fecha_nacimiento')

  // GUARDARRAÍL F-2b-4-3 (ANTES de cualquier escritura): si el email ya tiene una cuenta
  // OPERATIVA (con roles), invitar dejaría un niño ESQUELETO huérfano — la RPC de abajo lo
  // crearía y luego `inviteUserByEmail` fallaría con `email_exists`, sin vínculo ni
  // invitación. El camino correcto para un tutor con cuenta es "Añadir hijo a familia
  // existente" (F-2b-4-2), que da acceso directo. Se detecta con el MISMO patrón que
  // `crearTutorDirecto`/`accept-invitation`: `listUsers` (service-role) + roles activos →
  // `clasificarCuenta`. Como la comprobación va antes de la RPC, no se escribe NADA si es
  // 'real': no se crea niño, no queda huérfano. Cuentas `nueva`/`stub` (sin roles) siguen
  // por el flujo de invitación normal sin cambios.
  const service = createServiceRoleClient()
  const { data: existentes, indisponible: listIndisponible } = await llamarGoTrue('listUsers', () =>
    service.auth.admin.listUsers()
  )
  if (listIndisponible) return fail('auth.invitation.errors.servicio_cuentas_no_disponible')
  const authUser = (existentes?.users ?? []).find(
    (u) => u.email?.toLowerCase() === emailTutor.toLowerCase()
  )
  let tieneRoles = false
  if (authUser) {
    const { data: rolesPrevios } = await service
      .from('roles_usuario')
      .select('usuario_id')
      .eq('usuario_id', authUser.id)
      .is('deleted_at', null)
      .limit(1)
    tieneRoles = (rolesPrevios?.length ?? 0) > 0
  }
  if (clasificarCuenta(Boolean(authUser), tieneRoles) === 'real') {
    return fail('listaEspera.errors.tutor_ya_registrado_usar_anadir_hijo')
  }

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
    p_tutor_email: prospecto.email_tutor,
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
  //    `invitaciones`, dedupe nino_id-aware). El alta ya está creada por la RPC. Si esto
  //    falla, el alta queda creada SIN compensación en cascada (frontera limpia): el reenvío
  //    de invitación es el follow-up previsto (un re-invoke duplicaría el niño).
  const inv = await sendInvitation(
    {
      email: prospecto.email_tutor,
      rolObjetivo: 'tutor_legal',
      centroId,
      ninoId,
      tipoVinculo: 'tutor_legal_principal',
    },
    locale
  )
  if (!inv.success) return fail(inv.error)

  // 3. El prospecto sale de la cola. Best-effort: si falla, el alta+invitación ya existen;
  //    log y seguimos (el prospecto queda en_espera y se puede descartar a mano).
  const { error: estadoErr } = await supabase
    .from('lista_espera')
    .update({ estado: 'invitado' })
    .eq('id', prospecto.id)
  if (estadoErr) {
    logger.warn('invitarAlAlta estado update', estadoErr.message)
  }

  revalidatePath('/[locale]/admin/admisiones', 'page')
  return ok({ resultado: 'ok', ninoId, invitationId: inv.data.invitationId })
}
