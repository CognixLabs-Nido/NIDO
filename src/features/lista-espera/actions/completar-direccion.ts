'use server'

import { randomBytes } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import { motivoQueNoVuelve } from '@/features/centros/contexto/escribir-roles'
import { sendInvitation } from '@/features/auth/actions/send-invitation'
import { crearTutorDirecto } from '@/features/auth/lib/crear-tutor-directo'
import { detectarCuentaPorEmail } from '@/features/auth/lib/detectar-cuenta-email'
import { llamarGoTrue } from '@/features/auth/lib/llamar-gotrue'
import { esAdminEn, esSuperusuario } from '@/features/centros/contexto/roles-del-usuario'
import { permisosDefault } from '@/features/vinculos/schemas/vinculo'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Json } from '@/types/database'

import { tutorDeEsteCentro } from '../lib/resolver-tutor-email'
import { vincularHijoATutorExistente } from '../lib/vincular-hijo-tutor-existente'
import { completarDireccionSchema, type CompletarDireccionInput } from '../schemas/lista-espera'
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
 * Éxito de `completarEnDireccion`: alta creada (`ok` con nino_id) o COLISIÓN detectada por
 * la RPC (email ya en el centro con otro nombre) → la UI avisa a Dirección y NO navega.
 */
export type CompletarEnDireccionOk =
  // `usuarioId` null: la cuenta ya existía en otro sitio y se la ha invitado (aún no está enlazada).
  | { resultado: 'ok'; ninoId: string; usuarioId: string | null }
  | { resultado: 'colision'; nombreExistente: string | null }
  // FIX A: el tutor YA tenía familia en este centro → el hijo entró en ella (sin recrear cuenta,
  // sin contraseña, sin email). La UI lo distingue del alta con cuenta nueva.
  | { resultado: 'vinculado'; ninoId: string; usuarioId: string }

/**
 * F11 alta PR-3a "Completa Dirección" (ENTRADA; U-1): la Dirección PROMOCIONA un prospecto a
 * alta real en nombre del tutor, SIN enviar email. Espejo de `invitarAlAlta` (PR-2), pero en
 * lugar de `sendInvitation` crea la cuenta del tutor con `crearTutorDirecto` (createUser, no
 * inviteUserByEmail) y SIN contraseña tecleada (D2, ver abajo). Orquesta:
 *   1. crea un ESQUELETO de niño (centro + nombre/apellidos + fecha_nacimiento del prospecto),
 *   2. crea su MATRÍCULA `pendiente` contra (aula elegida, curso activo),
 *   3. `crearTutorDirecto`: cuenta + rol tutor_legal + vínculo tutor↔niño,
 *   4. marca el prospecto como `estado='invitado'` (sale de la cola; no hay estado propio).
 *
 * U-1 — esto es SOLO la promoción: la matrícula queda `pendiente` y aquí NO se marca lista
 * (`marcar_matricula_lista` es del gate del wizard). Devuelve `ninoId` para que la UI lleve al
 * WIZARD (`/alta/[ninoId]`, modo Dirección: admin del centro sin vínculo) donde se completan
 * acuses/autorizaciones como en el alta unificada. Ya NO se va a la ficha del niño.
 *
 * Todos los INSERT sensibles van por service role (bypass RLS) → gate admin explícito antes.
 * Rollback compensado en cascada si algún paso falla: no deja cuenta/niño/rol/matrícula huérfanos.
 */
export async function completarEnDireccion(
  input: CompletarDireccionInput,
  locale: 'es' | 'en' | 'va' = 'es'
): Promise<ActionResult<CompletarEnDireccionOk>> {
  const parsed = completarDireccionSchema.safeParse(input)
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
      'id, centro_id, nombre_nino, apellidos_nino, fecha_nacimiento, tutor_usuario_id, estado'
    )
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (!prospecto) return fail('listaEspera.errors.no_encontrado')
  const centroId = prospecto.centro_id

  // Gate admin del centro del prospecto (los INSERT van por service role → sin RLS que los cubra).
  if (!(await esAdminEn(supabase, userData.user.id, centroId)))
    return fail('auth.invitation.errors.forbidden')
  // Completar en Dirección registra, con la familia delante, los consentimientos del tutor como
  // presenciales (`crearTutorDirecto`). Eso lo hace la directora; el superusuario no (ADR-0061).
  // Aquí, porque `crearTutorDirecto` va con service role y la BD no sabe quién lo pidió.
  if (await esSuperusuario(supabase)) return fail('listaEspera.errors.presencial_solo_direccion')

  // Curso activo del centro (autoritativo server-side; la matrícula va contra él).
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

  // Debe estar en espera. A diferencia de invitar, el email NO sale del prospecto: lo teclea la
  // Dirección en el diálogo.
  if (prospecto.estado !== 'en_espera') return fail('listaEspera.errors.no_en_espera')

  // `fecha_nacimiento` es obligatoria para crear el niño (`ninos.fecha_nacimiento` NOT NULL).
  // Se captura en un const para que el narrowing sobreviva a los `await` posteriores.
  const fechaNacimiento = prospecto.fecha_nacimiento
  if (!fechaNacimiento) return fail('listaEspera.errors.sin_fecha_nacimiento')

  const service = createServiceRoleClient()

  // ¿Es el 2.º hijo de una familia de ESTE centro? Entonces se vincula a esa cuenta: no se recrea
  // ni se le pide contraseña. La regla es la de `invitarAlAlta` (`tutorDeEsteCentro`): primero la
  // cuenta que guardó el prospecto, si sigue teniendo familia aquí; si no, la del email.
  const tutorExistenteId = await tutorDeEsteCentro(service, {
    tutorPrevioId: prospecto.tutor_usuario_id,
    email: parsed.data.email,
    centroId,
  })
  if (tutorExistenteId === undefined)
    return fail('auth.invitation.errors.servicio_cuentas_no_disponible')
  if (tutorExistenteId) {
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

    // El prospecto sale de la cola (best-effort, como en la rama de cuenta nueva). U-4: se
    // guarda el `nino_id` → la lista pinta el estado de la matrícula y ofrece "Reanudar alta".
    const { error: estadoErr } = await supabase
      .from('lista_espera')
      .update({ estado: 'invitado', nino_id: vinc.data.ninoId })
      .eq('id', prospecto.id)
    if (estadoErr) logger.warn('completarEnDireccion estado update (vinculado)', estadoErr.message)

    revalidatePath('/[locale]/admin/admisiones', 'page')
    return ok({ resultado: 'vinculado', ninoId: vinc.data.ninoId, usuarioId: tutorExistenteId })
  }

  // Cuenta que ya existe y ha operado (de otro centro, del personal, el superusuario): no es de
  // este centro ni un alta a medias. No se le crea cuenta ni se le toca la contraseña, y nunca se
  // vincula sin que acepte (PR 1 de la Fase 4): el alta se crea con su perfil sin cuenta, se le
  // invita, y la Dirección sigue con el wizard igual que con una familia nueva (D4).
  const cuenta = await detectarCuentaPorEmail(service, parsed.data.email)
  if (!cuenta) return fail('auth.invitation.errors.servicio_cuentas_no_disponible')
  if (cuenta.authUserExiste && (cuenta.tieneRoles || cuenta.haOperado)) {
    return altaInvitandoCuentaExistente(supabase, {
      prospectoId: prospecto.id,
      nombreNino: prospecto.nombre_nino,
      apellidosNino: prospecto.apellidos_nino ?? '',
      fechaNacimiento,
      centroId,
      aulaId: parsed.data.aulaId,
      email: parsed.data.email,
      nombreTutor: `${parsed.data.nombreTutor} ${parsed.data.apellidosTutor}`,
      locale,
    })
  }

  // 1. Cuenta GoTrue PRIMERO (defensiva PR-A vía `crearTutorDirecto`). Si GoTrue falla, no se
  //    escribe nada en BD. Idempotente en reintento: una cuenta `stub` de un intento previo se
  //    reutiliza (no se re-crea). NO se crea niño/matrícula/rol/vínculo/perfil aquí: eso es la RPC.
  //
  //    D2: la Dirección NO teclea contraseña. La cuenta se crea con una contraseña ALEATORIA que
  //    NADIE usa ni ve (email_confirm=true la deja usable); el tutor fija la SUYA con «He olvidado
  //    la contraseña» (recuperación de Supabase). Prefijo `Aa1!` → cumple cualquier política de
  //    complejidad (mayúscula/minúscula/dígito/símbolo) sin depender del azar; el resto es entropía.
  const passwordAleatoria = `Aa1!${randomBytes(24).toString('base64url')}`
  const tutor = await crearTutorDirecto(service, {
    email: parsed.data.email,
    password: passwordAleatoria,
    // Nombre completo REAL del tutor (nombre + apellidos tecleados por la Dirección).
    nombreCompleto: `${parsed.data.nombreTutor} ${parsed.data.apellidosTutor}`,
    idiomaPreferido: locale,
  })
  if (!tutor.success) return fail(tutor.error)

  // 2. RPC transaccional (cliente AUTENTICADO → `es_admin(auth.uid(), p_centro_id)` autoriza
  //    dentro; `p_centro_id` es server-derivado, no falseable). En UNA transacción crea:
  //    familia + perfil en familia_tutores + niño (familia_id) + matrícula pendiente + vínculo
  //    + rol. Todo-o-nada: aquí NO queda ninguna escritura suelta que duplique lo suyo.
  const { data: rpcData, error: rpcError } = await supabase.rpc('crear_o_anadir_a_familia', {
    p_nombre_nino: prospecto.nombre_nino,
    p_apellidos_nino: prospecto.apellidos_nino ?? '',
    p_fecha_nacimiento: fechaNacimiento,
    p_centro_id: centroId,
    p_aula_id: parsed.data.aulaId,
    p_tutor_email: parsed.data.email,
    p_tutor_nombre_completo: `${parsed.data.nombreTutor} ${parsed.data.apellidosTutor}`,
    p_parentesco: parsed.data.parentesco,
    p_descripcion_parentesco: parsed.data.descripcionParentesco ?? '',
    p_usuario_id: tutor.data.usuarioId,
    p_permisos: permisosDefault('tutor_legal_principal') as Json,
  })
  if (rpcError) {
    // NO se borra la cuenta (frágil): el reintento es idempotente — la RPC es atómica (no dejó
    // residuo en BD) y `crearTutorDirecto` reutiliza la cuenta `stub` en el siguiente intento.
    logger.warn('completarEnDireccion rpc', rpcError.message)
    // La tabla de motivos de la BD no devuelve el rol a quien tiene en curso el olvido.
    if (motivoQueNoVuelve(rpcError) === 'solicitud_olvido')
      return fail('listaEspera.errors.tutor_olvido')
    return fail('listaEspera.errors.alta_fallo')
  }

  const res = rpcData as ResultadoCrearFamilia
  if (res.resultado === 'colision') {
    // Email ya en el centro con OTRO nombre → avisar a Dirección; NO completar (patrón PR-A).
    return ok({
      resultado: 'colision',
      nombreExistente: res.colision_info?.nombre_existente ?? null,
    })
  }

  // 3. El prospecto sale de la cola. Best-effort: si falla, el alta ya está creada; log y
  //    seguimos (el prospecto queda en_espera y se puede descartar a mano).
  const { error: estadoErr } = await supabase
    .from('lista_espera')
    .update({ estado: 'invitado', nino_id: res.nino_id as string })
    .eq('id', prospecto.id)
  if (estadoErr) {
    logger.warn('completarEnDireccion estado update', estadoErr.message)
  }

  revalidatePath('/[locale]/admin/admisiones', 'page')
  return ok({ resultado: 'ok', ninoId: res.nino_id as string, usuarioId: tutor.data.usuarioId })
}

/**
 * «Completar en Dirección» con un email que ya tiene una cuenta operativa fuera de este centro. La
 * RPC crea el alta con el perfil del tutor sin cuenta (`p_usuario_id` NULL, como al invitar) y
 * `sendInvitation` le avisa; al aceptar desde su perfil se enlaza. Mientras, la Dirección completa
 * el wizard en modo Dirección, que no necesita la cuenta del tutor.
 */
async function altaInvitandoCuentaExistente(
  supabase: Awaited<ReturnType<typeof createClient>>,
  p: {
    prospectoId: string
    nombreNino: string
    apellidosNino: string
    fechaNacimiento: string
    centroId: string
    aulaId: string
    email: string
    nombreTutor: string
    locale: 'es' | 'en' | 'va'
  }
): Promise<ActionResult<CompletarEnDireccionOk>> {
  const { data: rpcData, error: rpcError } = await supabase.rpc('crear_o_anadir_a_familia', {
    p_nombre_nino: p.nombreNino,
    p_apellidos_nino: p.apellidosNino,
    p_fecha_nacimiento: p.fechaNacimiento,
    p_centro_id: p.centroId,
    p_aula_id: p.aulaId,
    p_tutor_email: p.email,
    p_tutor_nombre_completo: p.nombreTutor,
    p_parentesco: '',
    p_descripcion_parentesco: '',
    // NULL = sin vincular: el rol y el vínculo los crea la aceptación.
    p_usuario_id: null as unknown as string,
    p_permisos: permisosDefault('tutor_legal_principal') as Json,
  })
  if (rpcError) {
    logger.warn('completarEnDireccion rpc (cuenta existente)', rpcError.message)
    return fail('listaEspera.errors.alta_fallo')
  }
  const res = rpcData as ResultadoCrearFamilia
  if (res.resultado === 'colision') {
    return ok({
      resultado: 'colision',
      nombreExistente: res.colision_info?.nombre_existente ?? null,
    })
  }
  const ninoId = res.nino_id as string

  const inv = await sendInvitation({
    email: p.email,
    rolObjetivo: 'tutor_legal',
    centroId: p.centroId,
    ninoId,
    tipoVinculo: 'tutor_legal_principal',
    idioma: p.locale,
  })

  // El prospecto sale de la cola aunque el correo no haya salido: el alta ya existe.
  const { error: estadoErr } = await supabase
    .from('lista_espera')
    .update({ estado: 'invitado', nino_id: ninoId })
    .eq('id', p.prospectoId)
  if (estadoErr) logger.warn('completarEnDireccion estado update (invitado)', estadoErr.message)
  revalidatePath('/[locale]/admin/admisiones', 'page')

  if (!inv.success) {
    logger.warn('completarEnDireccion: alta creada sin invitación', inv.error)
    return fail('listaEspera.errors.alta_creada_sin_correo')
  }
  return ok({ resultado: 'ok', ninoId, usuarioId: null })
}
