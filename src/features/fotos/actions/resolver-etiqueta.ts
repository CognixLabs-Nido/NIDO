'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { resolverEtiquetaSchema, type ResolverEtiquetaInput } from '../schemas/publicaciones'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * IU-5 — Dirección marca RESUELTA/conservada una etiqueta (foto×niño) de un niño con
 * imagen revocada: la ha pixelado/gestionado fuera del sistema y NO quiere borrar la
 * publicación. Sella `resuelta_en`/`resuelta_por` vía la RPC `resolver_etiqueta_imagen`
 * (SECURITY DEFINER, gate `es_admin` del centro de la etiqueta; idempotente). La foto no
 * se toca — sigue oculta a las familias por el flag. Borrar la publicación es otra acción
 * (`eliminarPublicacion`).
 */
export async function resolverEtiquetaImagen(
  input: ResolverEtiquetaInput
): Promise<ActionResult<null>> {
  const parsed = resolverEtiquetaSchema.safeParse(input)
  if (!parsed.success) return fail('fotos.errors.resolver_fallo')

  const supabase = await createClient()
  const { error } = await supabase.rpc('resolver_etiqueta_imagen', {
    p_media_etiqueta_id: parsed.data.media_etiqueta_id,
  })
  if (error) {
    logger.warn('resolverEtiquetaImagen', error.message)
    if (error.code === '42501') return fail('fotos.errors.no_autorizado')
    return fail('fotos.errors.resolver_fallo')
  }

  revalidatePath('/[locale]/admin/fotos-revocadas', 'page')
  revalidatePath('/[locale]/admin/fotos-revocadas/[ninoId]', 'page')
  return ok(null)
}
