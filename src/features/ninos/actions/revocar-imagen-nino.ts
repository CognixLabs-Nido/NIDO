'use server'

import { revalidatePath } from 'next/cache'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import { BUCKET_NINOS_FOTOS, borrarObjetosBucket, rutaThumbDe } from '@/shared/lib/adjuntos/storage'

import { revocarImagenNinoSchema, type RevocarImagenNinoInput } from '../schemas/imagen'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * IU-4 — revocar el consentimiento de imagen de UN niño, con efectos
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
 * Quién: Dirección del centro del niño (`es_admin`) o un tutor LEGAL de ese niño
 * (`es_tutor_legal_de`: principal/secundario, nunca un vínculo `autorizado`). Revocar cae el
 * consentimiento de AMBOS tutores, igual lo haga Dirección o un tutor. Se verifica antes de
 * tocar nada, para no dejar estado parcial (consent revocado sin perfil borrado). `foto_url`
 * se pone a NULL con la RPC `quitar_foto_perfil_nino` y el cliente de SESIÓN (PR-D, D2): la
 * RPC re-autoriza y `audit_log` registra al humano real. El service role queda solo para
 * borrar los blobs de Storage.
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

  // Dirección del centro del niño o tutor legal de ESE niño. El gate evita el estado parcial
  // de quien no puede (consent sin revocar pero perfil borrado, o al revés).
  const [{ data: esAdmin }, { data: esTutorLegal }] = await Promise.all([
    supabase.rpc('es_admin', { p_centro_id: nino.centro_id }),
    supabase.rpc('es_tutor_legal_de', { p_nino_id: ninoId }),
  ])
  if (!esAdmin && !esTutorLegal) return fail('nino.imagen.errors.no_autorizado')

  // (a) Revocar el consent → el flag baja a false por el trigger derivador → ocultación
  //     inmediata. La RPC re-gatea (es_admin OR es_tutor); aquí ya sabemos que puede.
  const { error: errRevoke } = await supabase.rpc('revocar_consentimiento_imagen', {
    p_nino_id: ninoId,
  })
  if (errRevoke) {
    logger.warn('revocarImagenNino: revoke', errRevoke.message)
    if (errRevoke.code === '42501') return fail('nino.imagen.errors.no_autorizado')
    return fail('nino.imagen.errors.fallo')
  }

  // (b) Eliminar la foto de PERFIL (si la hay): PRIMERO el fichero, DESPUÉS `foto_url → NULL`
  //     (decisión de Jose del 2026-11-25: «borra el fichero primero y la fila después»). Antes era
  //     al revés y el borrado del fichero se tragaba (`.catch(() => undefined)`): la familia había
  //     retirado el consentimiento y la foto de su hijo seguía en el bucket, sin fila que la nombrara.
  //     Esto no es la limpieza del fichero viejo de una sustitución: es seguir teniendo la imagen de
  //     un niño cuyos padres han dicho que no. Si el fichero no se borra, `foto_url` se queda: la
  //     ficha de Dirección lo enseña («consentimiento retirado y la foto sigue») y se puede repetir.
  //     El permiso ya se comprobó arriba (Dirección o tutor legal, como la política del bucket y la
  //     RPC); el fichero lo borra el servicio y la RPC, con la sesión, vuelve a mirarlo.
  if (nino.foto_url) {
    try {
      await borrarObjetosBucket(createServiceRoleClient(), BUCKET_NINOS_FOTOS, [
        nino.foto_url,
        rutaThumbDe(nino.foto_url),
      ])
    } catch (e) {
      logger.error(
        'revocarImagenNino: la foto de perfil no se borró (consentimiento ya retirado)',
        e instanceof Error ? e.message : String(e)
      )
      return fail('nino.imagen.errors.foto_no_borrada')
    }
    const { data: anterior, error: errFoto } = await supabase.rpc('quitar_foto_perfil_nino', {
      p_nino_id: ninoId,
    })
    if (errFoto) {
      // El fichero ya no está y la ficha aún lo nombra: se ve rota, y repetir lo arregla.
      logger.error('revocarImagenNino: quitar foto', errFoto.message)
      if (errFoto.code === '42501') return fail('nino.imagen.errors.no_autorizado')
      return fail('nino.imagen.errors.foto_no_borrada')
    }
    // Si entre la lectura y la RPC alguien cambió la foto, la que la RPC quitó es otra: también se
    // borra, y si no se puede, se dice (su ruta ya no está en la ficha; queda en el log).
    if (anterior && anterior !== nino.foto_url) {
      try {
        await borrarObjetosBucket(createServiceRoleClient(), BUCKET_NINOS_FOTOS, [
          anterior,
          rutaThumbDe(anterior),
        ])
      } catch (e) {
        logger.error(
          'revocarImagenNino: la foto cambiada entre medias no se borró',
          e instanceof Error ? e.message : String(e)
        )
        return fail('nino.imagen.errors.foto_no_borrada')
      }
    }
  }

  revalidatePath('/[locale]/admin/ninos/[id]', 'page')
  revalidatePath('/[locale]/family/nino/[id]', 'page')
  revalidatePath('/[locale]/family/autorizaciones/[id]', 'page')
  return ok(null)
}
