import 'server-only'

import { getTranslations } from 'next-intl/server'

import { urlDelAviso } from '@/features/centros/contexto/centro-del-aviso'
import { direccionDelCentro } from '@/features/centros/contexto/roles-de-otros'
import { getAutorPushInfo, profesDelAulaDelNino } from '@/features/push/lib/audiencia'
import { enviarPushPorIdioma } from '@/features/push/lib/enviar-por-idioma'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { logger } from '@/shared/lib/logger'

/**
 * Aviso AL MÓVIL de una autorización de recogida firmada por una familia: una nueva, o una
 * persona más (volver a firmar la lista es una firma nueva). Decisión de Jose del 2026-11-20
 * (opción B, `docs/specs/altas-serie.md`): la recogida vale desde que la familia la firma, sin
 * cola, y «debe llegar el aviso a la profesora y a la directora». Con el push de los mensajes y
 * los eventos, no uno nuevo. El aviso de dentro de la app («Ha llegado una firma nueva»,
 * `getAvisosInicio`) se queda: este lo lleva al móvil.
 *
 * A quién: las profes del aula del niño y la Dirección del centro (admin y directoras), menos
 * quien firmó. Cada uno abre la autorización en SU panel, donde están la lista y la foto del DNI.
 * El texto es genérico, como el de los mensajes: la notificación se ve con el móvil bloqueado.
 *
 * Best-effort: no lanza nunca. La firma ya está guardada; un push perdido no la deshace.
 */
export async function avisarRecogidaFirmada(args: {
  autorizacionId: string
  ninoId: string
  centroId: string
  autorId: string
}): Promise<void> {
  const { autorizacionId, ninoId, centroId, autorId } = args
  try {
    const service = createServiceRoleClient()
    const [profes, direccion, autor] = await Promise.all([
      profesDelAulaDelNino(ninoId),
      direccionDelCentro(service, centroId),
      getAutorPushInfo(autorId),
    ])
    const deDireccion = new Set((direccion ?? []).map((m) => m.usuarioId))
    deDireccion.delete(autorId)
    // Quien es de Dirección y además profe del aula recibe un solo aviso, el de Dirección.
    const soloProfes = profes.filter((id) => id !== autorId && !deDireccion.has(id))

    const enviar = (ids: string[], panel: 'teacher' | 'admin') =>
      enviarPushPorIdioma(ids, async (idioma) => ({
        titulo: autor.nombre,
        cuerpo: (await getTranslations({ locale: idioma, namespace: 'push.notificaciones' }))(
          'recogida_cuerpo'
        ),
        url: urlDelAviso(`/${idioma}/${panel}/autorizaciones/${autorizacionId}`, centroId),
        datos: { tipo: 'recogida_firmada', autorizacion_id: autorizacionId, nino_id: ninoId },
      }))

    await Promise.all([enviar(soloProfes, 'teacher'), enviar([...deDireccion], 'admin')])
  } catch (err) {
    logger.warn('avisarRecogidaFirmada', err instanceof Error ? err.message : String(err))
  }
}
