'use server'

import { revalidatePath } from 'next/cache'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { abrirConversacionAdminFamiliaSchema } from '../schemas/messaging'
import { fail, ok, type ActionResult } from '../types'

/**
 * Abre (o reabre) la conversación admin ↔ familia entre el admin autenticado
 * y el tutor `tutorId`. Operación unificada de creación + reapertura (spec
 * Fase 5.6-A §2.5).
 *
 * Comportamiento:
 *  - Si NO existe hilo `(admin=auth.uid(), tutor=tutorId, admin_familia)`:
 *    inserta uno nuevo con `expires_at = now() + 3 días`.
 *  - Si existe: actualiza SOLO `expires_at = now() + 3 días`. `admin_id`,
 *    `tutor_id` y `centro_id` NUNCA se mutan — la RLS UPDATE de admin_familia
 *    no lo restringe a nivel de columna (defensa en producto, no en BD).
 *
 * UPSERT manual (SELECT → INSERT/UPDATE) en vez de
 * `supabase.from(...).upsert(...)` porque la unicidad
 * `(admin_id, tutor_id)` está en un índice PARCIAL filtrado por
 * `tipo_conversacion = 'admin_familia'` y supabase-js no permite añadir el
 * predicado al `onConflict`. Race de doble clic mitigada capturando 23505
 * en el INSERT y reintentando como UPDATE.
 *
 * Errores tipados (i18n keys de `messages.errors.*`):
 *  - `no_autorizado`: sin sesión válida.
 *  - `solo_admin`: el usuario no tiene rol `admin` en ningún centro suyo.
 *  - `tutor_no_pertenece_centro`: el tutor no tiene vínculo activo con un
 *    niño del centro del admin.
 *  - `apertura_fallo`: error inesperado (lookup, INSERT o UPDATE).
 */
export async function abrirConversacionAdminFamilia(
  tutorId: string
): Promise<ActionResult<{ conversacion_id: string }>> {
  const parsed = abrirConversacionAdminFamiliaSchema.safeParse({ tutor_id: tutorId })
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'messages.errors.apertura_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('messages.errors.no_autorizado')

  const result = await abrirConversacionAdminFamiliaCore(supabase, userId, parsed.data.tutor_id)
  if (result.success) {
    revalidatePath('/[locale]/messages', 'layout')
  }
  return result
}

/**
 * Núcleo testeable: recibe el cliente Supabase y el `userId` explícitos. La
 * variante pública wireá `createClient()` + `auth.getUser()` desde el
 * contexto Next.js; los tests inyectan `clientFor(testUser)` del harness RLS
 * para validar el flujo extremo a extremo contra el remoto.
 *
 * No depende de `revalidatePath` ni del runtime de server actions — puede
 * invocarse desde Vitest sin contexto Next.
 */
export async function abrirConversacionAdminFamiliaCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  tutorId: string
): Promise<ActionResult<{ conversacion_id: string }>> {
  // 1. Determinar el centro del admin. Se exige rol `admin` activo. Si tiene
  //    rol admin en varios centros (Ola 2), tomamos el primero coherente con
  //    "donde el tutor pertenece" en el paso 2: filtramos los roles admin y
  //    probamos con cada centro.
  const { data: rolesAdmin, error: rolesErr } = await supabase
    .from('roles_usuario')
    .select('centro_id')
    .eq('usuario_id', userId)
    .eq('rol', 'admin')
    .is('deleted_at', null)

  if (rolesErr) {
    logger.warn('abrirConversacionAdminFamilia: roles fetch falló', rolesErr.message)
    return fail('messages.errors.apertura_fallo')
  }
  if (!rolesAdmin || rolesAdmin.length === 0) {
    return fail('messages.errors.solo_admin')
  }

  // 2. Buscar el centro donde el tutor tiene vínculo activo, intersectado
  //    con los centros en los que el admin es admin. RPC `es_tutor_en_centro`
  //    es SECURITY DEFINER, así que no atraviesa RLS — es la fuente
  //    autoritativa de la pertenencia.
  let centroId: string | null = null
  for (const r of rolesAdmin) {
    const { data: esTutor, error: rpcErr } = await supabase.rpc('es_tutor_en_centro', {
      p_tutor_id: tutorId,
      p_centro_id: r.centro_id,
    })
    if (rpcErr) {
      logger.warn('abrirConversacionAdminFamilia: rpc es_tutor_en_centro falló', rpcErr.message)
      return fail('messages.errors.apertura_fallo')
    }
    if (esTutor) {
      centroId = r.centro_id
      break
    }
  }
  if (!centroId) return fail('messages.errors.tutor_no_pertenece_centro')

  // 3. Lookup del hilo (admin=auth.uid(), tutor=tutorId, admin_familia).
  const { data: existente, error: selErr } = await supabase
    .from('conversaciones')
    .select('id')
    .eq('tipo_conversacion', 'admin_familia')
    .eq('admin_id', userId)
    .eq('tutor_id', tutorId)
    .maybeSingle()
  if (selErr) {
    logger.warn('abrirConversacionAdminFamilia: select hilo falló', selErr.message)
    return fail('messages.errors.apertura_fallo')
  }

  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

  // 4a. Reapertura — mutación restringida a `expires_at`. Aunque la RLS
  //     UPDATE de admin_familia permite cambiar cualquier columna al admin
  //     dueño, este action es la única vía pública y solo toca este campo.
  if (existente) {
    const { error: updErr } = await supabase
      .from('conversaciones')
      .update({ expires_at: expiresAt })
      .eq('id', existente.id)
    if (updErr) {
      if (updErr.code === '42501') return fail('messages.errors.no_autorizado')
      logger.warn('abrirConversacionAdminFamilia: update hilo falló', updErr.message)
      return fail('messages.errors.apertura_fallo')
    }
    return ok({ conversacion_id: existente.id })
  }

  // 4b. Creación. `centro_id` explícito: el trigger
  //     `conversaciones_set_centro_id` solo deriva desde `nino_id` si lo
  //     hay; admin_familia tiene `nino_id NULL` y haría RAISE sin nuestro
  //     valor explícito.
  const { data: nueva, error: insErr } = await supabase
    .from('conversaciones')
    .insert({
      tipo_conversacion: 'admin_familia',
      admin_id: userId,
      tutor_id: tutorId,
      centro_id: centroId,
      expires_at: expiresAt,
    })
    .select('id')
    .single()

  if (insErr || !nueva) {
    if (insErr?.code === '42501') return fail('messages.errors.no_autorizado')
    if (insErr?.code === '23505') {
      // Race de doble clic: alguien insertó entre el SELECT y este INSERT.
      // Recuperamos vía SELECT + UPDATE — semánticamente equivalente a reapertura.
      const { data: rec, error: recErr } = await supabase
        .from('conversaciones')
        .select('id')
        .eq('tipo_conversacion', 'admin_familia')
        .eq('admin_id', userId)
        .eq('tutor_id', tutorId)
        .single()
      if (recErr || !rec) {
        logger.warn(
          'abrirConversacionAdminFamilia: race recovery select falló',
          recErr?.message ?? 'sin fila'
        )
        return fail('messages.errors.apertura_fallo')
      }
      const { error: updRaceErr } = await supabase
        .from('conversaciones')
        .update({ expires_at: expiresAt })
        .eq('id', rec.id)
      if (updRaceErr) {
        logger.warn('abrirConversacionAdminFamilia: race recovery update falló', updRaceErr.message)
        return fail('messages.errors.apertura_fallo')
      }
      return ok({ conversacion_id: rec.id })
    }
    logger.warn('abrirConversacionAdminFamilia: insert hilo falló', insErr?.message)
    return fail('messages.errors.apertura_fallo')
  }

  return ok({ conversacion_id: nueva.id })
}
