'use server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { resolverInvitadosExplicitos } from '../lib/invitados'
import { puedeGestionarCita, revalidarAgenda } from '../lib/server-helpers'
import { agregarInvitadosSchema, type AgregarInvitadosInput } from '../schemas/citas'
import { fail, ok, type ActionResult, type CitaInvitadoInsert } from '../types'

/**
 * Añade invitados a una cita ya creada (AG-02). Organizador o admin. Expande la
 * selección explícita (individuos/grupos/externos), deduplica contra los ya
 * invitados y materializa las filas nuevas (`estado='pendiente'`).
 */
export async function agregarInvitados(
  input: AgregarInvitadosInput
): Promise<ActionResult<{ agregados: number }>> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('citas.errors.no_autorizado')

  const result = await agregarInvitadosCore(supabase, userId, input)
  if (result.success) revalidarAgenda()
  return result
}

export async function agregarInvitadosCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: AgregarInvitadosInput
): Promise<ActionResult<{ agregados: number }>> {
  const parsed = agregarInvitadosSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'citas.errors.invitados_fallo')
  }
  const d = parsed.data

  const { data: cita, error: readErr } = await supabase
    .from('citas')
    .select('centro_id, organizador_id, aula_id, estado')
    .eq('id', d.cita_id)
    .maybeSingle()
  if (readErr) {
    logger.warn('agregarInvitados: read cita', readErr.message)
    return fail('citas.errors.invitados_fallo')
  }
  if (!cita) return fail('citas.errors.no_encontrada')
  if (cita.estado === 'cancelada') return fail('citas.errors.cita_cancelada')

  // Pre-autorización (least-privilege) antes de las lecturas con service role.
  if (!(await puedeGestionarCita(supabase, cita.organizador_id, cita.centro_id, userId))) {
    return fail('citas.errors.no_autorizado')
  }

  const snapshot = await resolverInvitadosExplicitos({
    invitados: d.invitados,
    aula_id: cita.aula_id,
    centro_id: cita.centro_id,
    organizadorId: cita.organizador_id,
  })

  // Dedup contra los invitados internos ya existentes (la UNIQUE parcial también
  // lo impide a nivel BD, pero un duplicado abortaría el batch entero).
  const { data: existentes } = await supabase
    .from('cita_invitados')
    .select('usuario_id')
    .eq('cita_id', d.cita_id)
    .not('usuario_id', 'is', null)
  const yaInvitados = new Set((existentes ?? []).map((r) => r.usuario_id))
  const internosNuevos = snapshot.internos.filter((id) => !yaInvitados.has(id))

  const filas: CitaInvitadoInsert[] = [
    ...internosNuevos.map((uid) => ({
      cita_id: d.cita_id,
      centro_id: cita.centro_id,
      usuario_id: uid,
    })),
    ...snapshot.externos.map((nombre) => ({
      cita_id: d.cita_id,
      centro_id: cita.centro_id,
      nombre_externo: nombre,
    })),
  ]
  if (filas.length === 0) return ok({ agregados: 0 })

  const { error: insErr } = await supabase.from('cita_invitados').insert(filas)
  if (insErr) {
    logger.warn('agregarInvitados: insert', insErr.message)
    if (insErr.code === '42501') return fail('citas.errors.no_autorizado')
    return fail('citas.errors.invitados_fallo')
  }

  return ok({ agregados: filas.length })
}
