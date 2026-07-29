'use server'

import { revalidatePath } from 'next/cache'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import { BUCKET_NINOS_FOTOS, borrarObjetosBucket, rutaThumbDe } from '@/shared/lib/adjuntos/storage'

import { revocarImagenNinoSchema, type RevocarImagenNinoInput } from '../schemas/imagen'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * IU-4 — Dirección revoca el consentimiento de imagen de UN niño, con efectos
 * INMEDIATOS y automáticos:
 *   (a) `revocar_consentimiento_imagen(nino)` marca `revocado_en` → el trigger derivador
 *       baja `puede_aparecer_en_fotos` a false → el niño se OCULTA al instante de todas
 *       las publicaciones donde está etiquetado (RLS `usuario_ve_publicacion_row`, gratis).
 *   (b) se ELIMINA su foto de PERFIL: `ninos.foto_url → NULL` + se borra el blob (original
 *       + miniatura) de `ninos-fotos`. El perfil se ve por `es_tutor_de` (ajeno al flag),
 *       así que hay que quitarlo aparte.
 * NO borra fotos de publicaciones (decisión B: quedan ocultas hasta que Dirección las
 * resuelva a mano en IU-5). Por-niño estricto: no toca a los hermanos.
 *
 * Solo Dirección (por ahora): se verifica `es_admin(centro del niño)` antes de tocar nada,
 * para no dejar estado parcial (consent revocado sin perfil borrado). El borrado del perfil
 * va con service role TRAS autorizar (patrón ADR-0027, espejo de `fuentes-retencion`).
 */
export async function revocarImagenNino(
  input: RevocarImagenNinoInput
): Promise<ActionResult<null>> {
  const parsed = revocarImagenNinoSchema.safeParse(input)
  if (!parsed.success) return fail('nino.imagen.errors.fallo')
  const ninoId = parsed.data.nino_id

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('nino.imagen.errors.no_autorizado')

  // Ficha visible por RLS → centro (para el gate de admin) + foto_url (para borrar el blob).
  const { data: nino } = await supabase
    .from('ninos')
    .select('id, centro_id, foto_url')
    .eq('id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!nino) return fail('nino.imagen.errors.no_autorizado')

  // Solo Dirección (IU-4). El gate evita el estado parcial de un no-admin.
  const { data: esAdmin } = await supabase.rpc('es_admin', { p_centro_id: nino.centro_id })
  if (!esAdmin) return fail('nino.imagen.errors.no_autorizado')

  // (a) Revocar el consent → el flag baja a false por el trigger derivador → ocultación
  //     inmediata. La RPC re-gatea (es_admin OR es_tutor); aquí ya sabemos que es admin.
  const { error: errRevoke } = await supabase.rpc('revocar_consentimiento_imagen', {
    p_nino_id: ninoId,
  })
  if (errRevoke) {
    logger.warn('revocarImagenNino: revoke', errRevoke.message)
    if (errRevoke.code === '42501') return fail('nino.imagen.errors.no_autorizado')
    return fail('nino.imagen.errors.fallo')
  }

  // (b) Eliminar la foto de PERFIL (si la hay): foto_url → NULL + borrar blobs. Con service
  //     role tras autorizar; el trigger derivador deja el flag en false (consent ya revocado).
  if (nino.foto_url) {
    const service = createServiceRoleClient()
    const { error: errFoto } = await service
      .from('ninos')
      .update({ foto_url: null })
      .eq('id', ninoId)
    if (errFoto) {
      logger.warn('revocarImagenNino: foto_url null', errFoto.message)
      return fail('nino.imagen.errors.fallo')
    }
    await borrarObjetosBucket(service, BUCKET_NINOS_FOTOS, [
      nino.foto_url,
      rutaThumbDe(nino.foto_url),
    ]).catch(() => undefined)
  }

  revalidatePath('/[locale]/admin/ninos/[id]', 'page')
  return ok(null)
}
