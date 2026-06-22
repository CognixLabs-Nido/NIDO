'use server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { resolverInvitadosSnapshot } from '../lib/invitados'
import { puedeOrganizarCita, resolverCentroIdCita, revalidarAgenda } from '../lib/server-helpers'
import { crearCitaSchema, type CrearCitaInput } from '../schemas/citas'
import { fail, ok, type ActionResult, type CitaInvitadoInsert } from '../types'

/**
 * Crea una cita de la Agenda (F7b) e **invita** (materializa la lista nominal).
 * admin organiza cualquier tipo; profe solo `reunion_familia`/`reunion_clase`
 * (lo enforza la RLS de `citas`). `centro_id` resuelto server-side (no sentinel).
 *
 * Orden: resolver centro_id → resolver el snapshot de invitados (ANTES de
 * insertar, para no crear una cita huérfana sin invitados) → insertar la cita →
 * materializar `cita_invitados` (estado='pendiente'). Notificación push diferida
 * (fuera del core, AG-10).
 */
export async function crearCita(input: CrearCitaInput): Promise<ActionResult<{ cita_id: string }>> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('citas.errors.no_autorizado')

  const result = await crearCitaCore(supabase, userId, input)
  if (result.success) revalidarAgenda()
  return result
}

/** Núcleo testeable: cliente + userId explícitos. */
export async function crearCitaCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: CrearCitaInput
): Promise<ActionResult<{ cita_id: string }>> {
  const parsed = crearCitaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'citas.errors.creacion_fallo')
  }
  const d = parsed.data

  // 1. centro_id explícito (claustro/visita → centro del organizador).
  const centroResult = await resolverCentroIdCita(
    supabase,
    userId,
    d.tipo,
    d.nino_id ?? null,
    d.aula_id ?? null
  )
  if (!centroResult.success) return centroResult
  const centroId = centroResult.data

  // 2. Pre-autorización (espejo de citas_insert) ANTES de leer con service role:
  // least-privilege; la RLS del INSERT sigue siendo el gate real (B3).
  if (
    !(await puedeOrganizarCita(supabase, d.tipo, centroId, d.nino_id ?? null, d.aula_id ?? null))
  ) {
    return fail('citas.errors.no_autorizado')
  }

  // 3. Snapshot de invitados ANTES de insertar la cita (evita citas huérfanas).
  const snapshot = await resolverInvitadosSnapshot({
    tipo: d.tipo,
    centro_id: centroId,
    nino_id: d.nino_id ?? null,
    aula_id: d.aula_id ?? null,
    invitados: d.invitados,
    organizadorId: userId,
  })
  if (snapshot.internos.length === 0 && snapshot.externos.length === 0) {
    return fail('citas.errors.sin_invitados')
  }

  // 4. Insertar la cita.
  const { data: creada, error: insErr } = await supabase
    .from('citas')
    .insert({
      centro_id: centroId,
      tipo: d.tipo,
      aula_id: d.tipo === 'reunion_clase' ? d.aula_id! : null,
      nino_id: d.tipo === 'reunion_familia' ? d.nino_id! : null,
      organizador_id: userId,
      titulo: d.titulo,
      descripcion: d.descripcion ?? null,
      lugar: d.lugar ?? null,
      fecha: d.fecha,
      hora_inicio: d.hora_inicio,
      hora_fin: d.hora_fin ?? null,
    })
    .select('id')
    .single()

  if (insErr || !creada) {
    logger.warn('crearCita: insert cita', insErr?.message)
    if (insErr?.code === '42501') return fail('citas.errors.no_autorizado')
    return fail('citas.errors.creacion_fallo')
  }

  // 5. Materializar invitados (snapshot, estado='pendiente' por default de BD).
  const filas: CitaInvitadoInsert[] = [
    ...snapshot.internos.map((uid) => ({
      cita_id: creada.id,
      centro_id: centroId,
      usuario_id: uid,
    })),
    ...snapshot.externos.map((nombre) => ({
      cita_id: creada.id,
      centro_id: centroId,
      nombre_externo: nombre,
    })),
  ]
  const { error: invErr } = await supabase.from('cita_invitados').insert(filas)
  if (invErr) {
    logger.warn('crearCita: insert invitados', invErr.message)
    // Limpieza best-effort SOLO en esta rama: la cita ya existe pero quedó sin
    // invitados. El DELETE de usuario está bloqueado (default DENY) → service
    // role. El audit de citas registra el DELETE (valores_antes) → trazabilidad.
    const service = createServiceRoleClient()
    const { error: delErr } = await service.from('citas').delete().eq('id', creada.id)
    if (delErr) logger.warn('crearCita: limpieza de cita huérfana', delErr.message)
    return fail('citas.errors.invitados_fallo')
  }

  return ok({ cita_id: creada.id })
}
