'use server'

import { revalidatePath } from 'next/cache'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { getAulaById } from '@/features/aulas/queries/get-aulas'

import { borrarObjetos } from '../lib/storage'
import {
  crearPublicacionSchema,
  editarPublicacionSchema,
  eliminarMediaSchema,
  eliminarPublicacionSchema,
  type CrearPublicacionInput,
  type EditarPublicacionInput,
  type EliminarMediaInput,
  type EliminarPublicacionInput,
} from '../schemas/publicaciones'
import { fail, ok, type ActionResult } from '../types'

function revalidarFotos(): void {
  revalidatePath('/[locale]/teacher/aula/[id]/fotos', 'page')
}

/**
 * Crea una publicación (contenedor del post) en un aula. **Directa** (sin estado
 * borrador): la fila existe desde ya y es editable. `centro_id` lo deriva el
 * trigger, pero el tipo Insert lo exige → se pasa el del aula. Solo coordinadora/
 * profesora del aula o admin (RLS `publicaciones_insert` → `autor_id=auth.uid()`
 * AND (es_admin OR es_redactor_de_aula)). Las fotos se suben después al route
 * handler `/api/fotos/upload` contra el `publicacion_id` devuelto.
 */
export async function crearPublicacion(
  input: CrearPublicacionInput
): Promise<ActionResult<{ publicacion_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('fotos.errors.no_autorizado')

  const parsed = crearPublicacionSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'fotos.errors.creacion_fallo')
  }
  const { aula_id, texto } = parsed.data

  const aula = await getAulaById(aula_id)
  if (!aula) return fail('fotos.errors.aula_no_encontrada')

  const { data: creada, error } = await supabase
    .from('publicaciones')
    .insert({
      centro_id: aula.centro_id,
      aula_id,
      autor_id: user.id,
      texto: texto && texto.length > 0 ? texto : null,
    })
    .select('id')
    .maybeSingle()

  if (error || !creada) {
    logger.warn('crearPublicacion: insert', error?.message)
    if (error?.code === '42501') return fail('fotos.errors.no_autorizado')
    return fail('fotos.errors.creacion_fallo')
  }

  revalidarFotos()
  return ok({ publicacion_id: creada.id })
}

/**
 * Edita el texto de una publicación. **Editar NO re-avisa** (P-edición): el aviso
 * de inicio se deriva de `created_at`, que no cambia. Solo autor o admin (RLS).
 */
export async function editarPublicacion(
  input: EditarPublicacionInput
): Promise<ActionResult<{ publicacion_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('fotos.errors.no_autorizado')

  const parsed = editarPublicacionSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'fotos.errors.guardado_fallo')
  }
  const { publicacion_id, texto } = parsed.data

  const { data: upd, error } = await supabase
    .from('publicaciones')
    .update({ texto: texto && texto.length > 0 ? texto : null })
    .eq('id', publicacion_id)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('editarPublicacion: update', error.message)
    if (error.code === '42501') return fail('fotos.errors.no_autorizado')
    return fail('fotos.errors.guardado_fallo')
  }
  if (!upd) return fail('fotos.errors.no_autorizado')

  revalidarFotos()
  return ok({ publicacion_id: upd.id })
}

/**
 * Borrado REAL de una publicación (P-borrado): borra la fila (CASCADE elimina
 * `media`/`media_etiquetas`) **y** los objetos de Storage (sin huérfanos). Solo
 * autor o admin (RLS DELETE). Se recogen las rutas ANTES de borrar la fila; los
 * objetos se eliminan con service role tras confirmar el borrado autorizado.
 */
export async function eliminarPublicacion(
  input: EliminarPublicacionInput
): Promise<ActionResult<{ publicacion_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('fotos.errors.no_autorizado')

  const parsed = eliminarPublicacionSchema.safeParse(input)
  if (!parsed.success) return fail('fotos.errors.borrado_fallo')
  const { publicacion_id } = parsed.data

  // Rutas de los objetos a limpiar (visibles para el autor/admin vía RLS de media).
  const { data: medias } = await supabase
    .from('media')
    .select('path, path_miniatura')
    .eq('publicacion_id', publicacion_id)

  const { error, count } = await supabase
    .from('publicaciones')
    .delete({ count: 'exact' })
    .eq('id', publicacion_id)

  if (error) {
    logger.warn('eliminarPublicacion: delete', error.message)
    if (error.code === '42501') return fail('fotos.errors.no_autorizado')
    return fail('fotos.errors.borrado_fallo')
  }
  if (!count) return fail('fotos.errors.no_autorizado')

  // La fila se borró (CASCADE limpió media/etiquetas). Ahora los objetos.
  const paths = (medias ?? []).flatMap((m) => [m.path, m.path_miniatura])
  if (paths.length > 0) {
    const service = await createServiceClient()
    await borrarObjetos(
      service,
      paths.filter((p): p is string => typeof p === 'string')
    )
  }

  revalidarFotos()
  return ok({ publicacion_id })
}

/**
 * Quita UNA foto de una publicación: borra la fila `media` (CASCADE limpia sus
 * etiquetas) y sus dos objetos en Storage. Solo autor de la publicación o admin
 * (RLS DELETE de `media`).
 */
export async function eliminarMedia(
  input: EliminarMediaInput
): Promise<ActionResult<{ media_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('fotos.errors.no_autorizado')

  const parsed = eliminarMediaSchema.safeParse(input)
  if (!parsed.success) return fail('fotos.errors.borrado_fallo')
  const { media_id } = parsed.data

  const { data: media } = await supabase
    .from('media')
    .select('path, path_miniatura')
    .eq('id', media_id)
    .maybeSingle()

  const { error, count } = await supabase
    .from('media')
    .delete({ count: 'exact' })
    .eq('id', media_id)

  if (error) {
    logger.warn('eliminarMedia: delete', error.message)
    if (error.code === '42501') return fail('fotos.errors.no_autorizado')
    return fail('fotos.errors.borrado_fallo')
  }
  if (!count) return fail('fotos.errors.no_autorizado')

  if (media) {
    const service = await createServiceClient()
    await borrarObjetos(
      service,
      [media.path, media.path_miniatura].filter((p): p is string => typeof p === 'string')
    )
  }

  revalidarFotos()
  return ok({ media_id })
}
