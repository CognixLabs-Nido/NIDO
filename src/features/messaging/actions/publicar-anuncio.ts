'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'

import { urlDelAviso } from '@/features/centros/contexto/centro-del-aviso'
import { destinatariosPushDeAnuncio } from '@/features/push/lib/audiencia'
import { enviarPushPorIdioma } from '@/features/push/lib/enviar-por-idioma'
import { createClient } from '@/lib/supabase/server'
import { rolesEnCentro } from '@/features/centros/contexto/roles-del-usuario'
import { logger } from '@/shared/lib/logger'

import { anuncioInputSchema, type AnuncioInput } from '../schemas/messaging'
import { fail, ok, type ActionResult } from '../types'

/**
 * Publica un anuncio. RLS WITH CHECK de anuncios.INSERT valida:
 *  - autor_id = auth.uid()
 *  - admin del centro (cualquier ámbito) OR
 *  - profe activo del aula (solo ámbito='aula' con su aula y mismo centro).
 *
 * El server action:
 *  1. Valida Zod (cross-field ámbito ↔ aula).
 *  2. Toma el `centro_id` de la página y el rol del usuario en ese centro.
 *  3. Si rol = profe, fuerza ámbito='aula' (defensa en profundidad ante UI
 *     manipulable). Si rol = admin, permite ambos ámbitos.
 *  4. Inserta. RLS hace la verificación final.
 */
export async function publicarAnuncio(
  input: AnuncioInput,
  centroId: string
): Promise<ActionResult<{ anuncio_id: string }>> {
  const parsed = anuncioInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'messages.errors.envio_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('messages.errors.no_autorizado')

  const rol = (await rolesEnCentro(supabase, userId, centroId))?.rol
  if (rol !== 'admin' && rol !== 'profe') {
    return fail('messages.errors.no_autorizado')
  }

  // Defensa en profundidad: profe solo puede publicar ámbito='aula'.
  if (rol === 'profe' && parsed.data.ambito === 'centro') {
    return fail('messages.errors.no_autorizado')
  }

  // R3 (multi-centro): el aula tiene que ser del centro de la página. Un admin del centro A no
  // publica en un aula del centro B (la BD también lo para: policy + trigger).
  if (parsed.data.aula_id) {
    const { data: aula } = await supabase
      .from('aulas')
      .select('id')
      .eq('id', parsed.data.aula_id)
      .eq('centro_id', centroId)
      .maybeSingle()
    if (!aula) return fail('messages.errors.no_autorizado')
  }

  const { data, error } = await supabase
    .from('anuncios')
    .insert({
      autor_id: userId,
      centro_id: centroId,
      ambito: parsed.data.ambito,
      aula_id: parsed.data.aula_id,
      titulo: parsed.data.titulo,
      contenido: parsed.data.contenido,
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('publicarAnuncio falló', error?.message)
    return fail('messages.errors.envio_fallo')
  }

  // Push notifications (F5.5). Solo a tutores con `puede_recibir_mensajes`
  // del aula (ámbito=aula) o centro (ámbito=centro). Profes y admin ven el
  // anuncio in-app y actúan como puente humano para tutores excluidos.
  try {
    const destinatarios = await destinatariosPushDeAnuncio(
      {
        centro_id: centroId,
        ambito: parsed.data.ambito,
        aula_id: parsed.data.aula_id,
      },
      userId
    )
    if (destinatarios.length > 0) {
      // Sin el texto del anuncio (F11-B, punto 8): la notificación se ve en la pantalla
      // bloqueada. En el idioma de cada destinatario: el título, el aviso y el enlace.
      await enviarPushPorIdioma(destinatarios, async (idioma) => {
        const tPush = await getTranslations({ locale: idioma, namespace: 'push.notificaciones' })
        return {
          titulo:
            parsed.data.ambito === 'centro'
              ? tPush('anuncio_centro_titulo')
              : tPush('anuncio_aula_titulo'),
          cuerpo: parsed.data.contenido,
          url: urlDelAviso(`/${idioma}/messages/anuncios/${data.id}`, centroId),
          datos: {
            tipo: 'anuncio',
            anuncio_id: data.id,
          },
        }
      })
    }
  } catch (err) {
    console.error('[publicarAnuncio] push notifications falló:', err)
  }

  revalidatePath('/[locale]/messages', 'layout')
  return ok({ anuncio_id: data.id })
}
