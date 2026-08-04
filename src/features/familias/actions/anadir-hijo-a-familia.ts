'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { elegirAdultoConCuenta } from '../lib/adulto-con-cuenta'
import { anadirHijoAFamiliaSchema, type AnadirHijoAFamiliaInput } from '../schemas/anadir-hijo'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * U-2 (alta unificada) — Dirección añade un 2.º hijo a una familia EXISTENTE.
 *
 * ANTES (F-2b-4-2): esta acción creaba el niño + la matrícula DIRECTAMENTE con la RPC
 * `crear_o_anadir_a_familia`, saltándose `lista_espera`. Consecuencia real: el alumno no
 * aparecía en admisiones y se perdía de vista (además nacía sin acuses ni autorizaciones,
 * porque nunca pasaba por el wizard).
 *
 * AHORA: crea un PROSPECTO en la lista de espera del curso activo, exactamente igual que
 * cualquier otro alumno. A partir de ahí se gestiona con las acciones de admisiones de
 * siempre (Invitar / Completar), que son la ÚNICA puerta que crea niño + matrícula.
 *
 * D1 — el prospecto guarda `tutor_usuario_id` (la cuenta del tutor ya existente) además del
 * email. Al promover, ese `usuario_id` vincula el hijo a la familia correcta sin depender de
 * que el email se re-teclee igual (la detección por email de FIX B #261 queda de respaldo
 * para los prospectos normales). Aquí se resuelve el adulto CON CUENTA de la familia
 * (titular preferido), que es lo único que hace falta persistir.
 *
 * NO se pide aula ni parentesco: el aula se elige al promover (es entonces cuando nace la
 * matrícula) y el parentesco lo hereda `vincularHijoATutorExistente` del vínculo previo del
 * tutor. Tampoco se manda push: aún no hay alta que anunciar — el aviso al tutor llega
 * cuando se promociona.
 *
 * El nombre de la función se conserva (la vía sigue siendo "añadir hijo a familia
 * existente"); la jubilación del código muerto de la puerta vieja es U-5.
 */
export async function anadirHijoAFamilia(
  input: AnadirHijoAFamiliaInput
): Promise<ActionResult<{ prospectoId: string }>> {
  const parsed = anadirHijoAFamiliaSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'admin.admisiones.anadirHijo.validation.invalid')

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return fail('auth.invitation.errors.unauthenticated')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('listaEspera.errors.sin_centro')

  // Gate admin del centro (los reads de familia van por service role → gate explícito).
  const { data: roles } = await supabase
    .from('roles_usuario')
    .select('rol, centro_id')
    .eq('usuario_id', userData.user.id)
    .is('deleted_at', null)
  const isAdmin = roles?.some((r) => r.centro_id === centroId && r.rol === 'admin')
  if (!isAdmin) return fail('auth.invitation.errors.forbidden')

  // El prospecto entra en la cola del curso ACTIVO (server-derivado, como en `crearProspecto`).
  const { data: cursoActivoId } = await supabase.rpc('curso_activo_de_centro', {
    p_centro_id: centroId,
  })
  if (!cursoActivoId) return fail('listaEspera.errors.sin_curso_activo')

  const service = createServiceRoleClient()

  // La familia debe pertenecer al centro del admin. Esto es lo que hace que el
  // `tutor_usuario_id` guardado sea coherente con el centro del prospecto (la BD no lo
  // enforza; ver la migración U-2).
  const { data: familia } = await service
    .from('familias')
    .select('id, centro_id')
    .eq('id', parsed.data.familia_id)
    .maybeSingle()
  if (!familia || familia.centro_id !== centroId)
    return fail('admin.admisiones.anadirHijo.errors.familia_no_encontrada')

  // Adulto CON CUENTA de la familia (titular preferido). Sin ninguno → familia no elegible:
  // sin cuenta no hay `usuario_id` que guardar y esto no sería un 2.º hijo de nadie.
  const { data: tutores } = await service
    .from('familia_tutores')
    .select('usuario_id, nombre_completo, email, rol_familia')
    .eq('familia_id', parsed.data.familia_id)
    .is('deleted_at', null)
  const adulto = elegirAdultoConCuenta(tutores ?? [])
  if (!adulto) return fail('admin.admisiones.anadirHijo.errors.familia_no_elegible')

  // Siguiente posición de la cola (sobre TODAS las filas del curso, no solo `en_espera`,
  // para no colisionar con invitados/descartados que conservan su `posicion`).
  const { data: ultima } = await supabase
    .from('lista_espera')
    .select('posicion')
    .eq('curso_academico_id', cursoActivoId)
    .order('posicion', { ascending: false })
    .limit(1)
    .maybeSingle()
  const posicion = (ultima?.posicion ?? 0) + 1

  // Insert por el cliente AUTENTICADO → lo cubre `lista_espera_admin_all` (RLS por centro).
  // `centro_id` lo sobrescribe el trigger desde el curso; se pasa para satisfacer el tipo.
  const { data: creado, error } = await supabase
    .from('lista_espera')
    .insert({
      centro_id: centroId,
      curso_academico_id: cursoActivoId,
      nombre_nino: parsed.data.nombre,
      apellidos_nino: parsed.data.apellidos,
      fecha_nacimiento: parsed.data.fecha_nacimiento,
      email_tutor: adulto.email,
      // D1: la pista EXACTA para vincular al promover.
      tutor_usuario_id: adulto.usuarioId,
      posicion,
    })
    .select('id')
    .single()
  if (error || !creado) {
    logger.warn('anadirHijoAFamilia insert prospecto', error?.message)
    return fail('listaEspera.errors.crear_fallo')
  }

  revalidatePath('/[locale]/admin/admisiones', 'page')
  return ok({ prospectoId: creado.id })
}
