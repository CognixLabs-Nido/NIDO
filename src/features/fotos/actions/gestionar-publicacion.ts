'use server'

import { revalidatePath } from 'next/cache'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { getAulaById } from '@/features/aulas/queries/get-aulas'

import { borrarFotosDelBlog, prefijoPublicacion, rutasBorrables } from '../lib/storage'
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
import { falloDeLectura } from '@/shared/lib/frontera-lectura'

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
  try {
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
  } catch (e) {
    return falloDeLectura(e)
  }
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
 * Las fotos del blog se borran ANTES que su fila (decisión de Jose del 2026-11-25, «borra el fichero
 * primero y la fila después», lo que ya hacen las purgas para no perder la ruta). Con la sesión: la
 * política de Storage autoriza lo mismo que la de la fila. Si alguna foto sigue en el bucket, la fila
 * NO se borra: queda con su ruta y se puede reintentar. Antes era al revés y, si Storage fallaba (o
 * fallaba la lectura de las rutas), la fila se iba, la acción contestaba ok y las fotos de los niños
 * se quedaban en el bucket sin nada que las nombrara.
 *
 * Devuelve el fallo que hay que contestar, o null si las fotos ya no están.
 */
async function borrarFotosAntes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rutas: string[],
  donde: string
): Promise<ActionResult<never> | null> {
  if (rutas.length === 0) return null
  try {
    const siguen = await borrarFotosDelBlog(supabase, createServiceRoleClient(), rutas)
    if (siguen.length === 0) return null
    // Storage no da error al negar: si quien borra no puede, las fotos siguen. La fila tampoco se
    // podría borrar; el mensaje dice lo que pasa (no se han borrado), no una causa que no sabemos.
    logger.error(`${donde}: las fotos siguen en Storage, la fila no se borra`, siguen.length)
    return fail('fotos.errors.fotos_no_borradas')
  } catch (e) {
    logger.error(`${donde}: Storage`, e instanceof Error ? e.message : String(e))
    return fail('fotos.errors.fotos_no_borradas')
  }
}

/**
 * Borrado REAL de una publicación (P-borrado): primero los objetos de Storage, después la fila
 * (CASCADE elimina `media`/`media_etiquetas`). Solo autor o admin (las dos políticas, la de Storage
 * y la de la fila, lo deciden en la base). Si una lectura falla, no se borra nada: sin las rutas, la
 * fila se iría y las fotos quedarían huérfanas.
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

  // Prefijo de Storage de la publicación (de la FILA) y rutas de los objetos (visibles para el
  // autor/admin vía RLS). Un fallo de lectura no es «no hay fotos»: para.
  const { data: pub, error: pubErr } = await supabase
    .from('publicaciones')
    .select('centro_id, aula_id')
    .eq('id', publicacion_id)
    .maybeSingle()
  if (pubErr) {
    logger.error('eliminarPublicacion: leer la publicación', pubErr.message)
    return fail('fotos.errors.borrado_fallo')
  }
  if (!pub) return fail('fotos.errors.no_autorizado')
  const { data: medias, error: mErr } = await supabase
    .from('media')
    .select('path, path_miniatura')
    .eq('publicacion_id', publicacion_id)
  if (mErr) {
    logger.error('eliminarPublicacion: leer las fotos', mErr.message)
    return fail('fotos.errors.borrado_fallo')
  }

  // Solo las rutas de esta publicación (R4): una ruta ajena en una fila `media` no se borra.
  const prefijo = prefijoPublicacion(pub.centro_id, pub.aula_id, publicacion_id)
  const { rutas, ajenas } = rutasBorrables(medias ?? [], prefijo)
  if (ajenas > 0)
    logger.warn('eliminarPublicacion: rutas ajenas a la publicación, no se borran', ajenas)
  const fallo = await borrarFotosAntes(supabase, rutas, 'eliminarPublicacion')
  if (fallo) return fallo

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

  revalidarFotos()
  return ok({ publicacion_id })
}

/**
 * Quita UNA foto de una publicación: primero sus dos objetos en Storage, después la fila `media`
 * (CASCADE limpia sus etiquetas). Solo autor de la publicación o admin (RLS DELETE de `media` y la
 * política de Storage). Si la lectura falla, no se borra nada.
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

  const { data: media, error: mErr } = await supabase
    .from('media')
    .select('path, path_miniatura, publicacion_id, publicaciones(centro_id, aula_id)')
    .eq('id', media_id)
    .maybeSingle()
  if (mErr) {
    logger.error('eliminarMedia: leer la foto', mErr.message)
    return fail('fotos.errors.borrado_fallo')
  }
  if (!media) return fail('fotos.errors.no_autorizado')

  // Solo las rutas de la publicación de la fila (R4); una ruta ajena NO se borra. Sin la
  // publicación (no debería: la FK es NOT NULL) no hay prefijo y no se borra ningún objeto.
  const pub = media.publicaciones
  const prefijo = pub ? prefijoPublicacion(pub.centro_id, pub.aula_id, media.publicacion_id) : null
  const { rutas, ajenas } = rutasBorrables([media], prefijo)
  if (ajenas > 0) logger.warn('eliminarMedia: rutas ajenas a la publicación, no se borran', ajenas)
  const fallo = await borrarFotosAntes(supabase, rutas, 'eliminarMedia')
  if (fallo) return fallo

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

  revalidarFotos()
  return ok({ media_id })
}
