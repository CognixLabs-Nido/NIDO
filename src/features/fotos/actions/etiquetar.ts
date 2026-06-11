'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  desetiquetarSchema,
  etiquetarSchema,
  type DesetiquetarInput,
  type EtiquetarInput,
} from '../schemas/publicaciones'
import { fail, ok, type ActionResult } from '../types'

function revalidarFotos(): void {
  revalidatePath('/[locale]/teacher/aula/[id]/fotos', 'page')
}

/**
 * Etiqueta a un niño en una foto. **Gate P2**: solo niños con
 * `puede_aparecer_en_fotos = true` (lo impone la RLS de `media_etiquetas_insert`
 * vía `nino_puede_aparecer`); un intento sin permiso devuelve el aviso
 * `fotos.errors.nino_sin_permiso`. `centro_id` se deriva del media (lo pone el
 * trigger, pero el tipo Insert lo exige). Idempotente por el UNIQUE(media, niño).
 */
export async function etiquetarNino(
  input: EtiquetarInput
): Promise<ActionResult<{ media_id: string; nino_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('fotos.errors.no_autorizado')

  const parsed = etiquetarSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'fotos.errors.etiquetado_fallo')
  }
  const { media_id, nino_id } = parsed.data

  // `centro_id` del media (visible al autor/admin vía RLS de media).
  const { data: media } = await supabase
    .from('media')
    .select('centro_id')
    .eq('id', media_id)
    .maybeSingle()
  if (!media) return fail('fotos.errors.no_autorizado')

  const { error } = await supabase
    .from('media_etiquetas')
    .insert({ media_id, nino_id, centro_id: media.centro_id })

  if (error) {
    // 23505 = ya etiquetado (UNIQUE) → idempotente, lo tratamos como éxito.
    if (error.code === '23505') {
      revalidarFotos()
      return ok({ media_id, nino_id })
    }
    logger.warn('etiquetarNino: insert', error.message)
    // 42501 (RLS) o 23514 (CHECK): el niño no tiene permiso de aparecer.
    if (error.code === '42501' || error.code === '23514') {
      return fail('fotos.errors.nino_sin_permiso')
    }
    return fail('fotos.errors.etiquetado_fallo')
  }

  revalidarFotos()
  return ok({ media_id, nino_id })
}

/** Quita la etiqueta de un niño en una foto. Solo autor o admin (RLS DELETE). */
export async function desetiquetarNino(
  input: DesetiquetarInput
): Promise<ActionResult<{ media_id: string; nino_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('fotos.errors.no_autorizado')

  const parsed = desetiquetarSchema.safeParse(input)
  if (!parsed.success) return fail('fotos.errors.etiquetado_fallo')
  const { media_id, nino_id } = parsed.data

  const { error } = await supabase
    .from('media_etiquetas')
    .delete()
    .eq('media_id', media_id)
    .eq('nino_id', nino_id)

  if (error) {
    logger.warn('desetiquetarNino: delete', error.message)
    if (error.code === '42501') return fail('fotos.errors.no_autorizado')
    return fail('fotos.errors.etiquetado_fallo')
  }

  revalidarFotos()
  return ok({ media_id, nino_id })
}
