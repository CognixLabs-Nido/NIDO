import 'server-only'

import { getTranslations } from 'next-intl/server'

import { getAutorPushInfo } from '@/features/push/lib/audiencia'
import { enviarPushPorIdioma } from '@/features/push/lib/enviar-por-idioma'
import type { Idioma } from '@/features/push/lib/idioma'

import type { AmbitoEvento } from '../types'
import { audienciaPushEvento, tutoresDeNinosConfirmados } from './audiencia'

interface EventoPush {
  id: string
  ambito: AmbitoEvento
  centro_id: string
  aula_id: string | null
  nino_id: string | null
  titulo: string
}

function cuerpoDe(titulo: string): string {
  return titulo.length > 100 ? titulo.slice(0, 99) + '…' : titulo
}

/**
 * Envía un push a la audiencia del evento. **Único punto de envío** para
 * crear/editar — el `tipo` (categoría de la noti, como en cancelar) y el cuerpo
 * son lo que varía. `construirCuerpo` recibe el idioma de cada DESTINATARIO
 * (`enviarPushPorIdioma`) para traducir el copy. No lanza nunca: un fallo de
 * push no rompe la operación.
 */
async function enviarAAudiencia(
  userId: string,
  evento: EventoPush,
  tipo: string,
  construirCuerpo: (idioma: Idioma) => Promise<string> | string
): Promise<void> {
  try {
    const destinatarios = await audienciaPushEvento(evento, userId)
    if (destinatarios.length === 0) return
    const autor = await getAutorPushInfo(userId)
    await enviarPushPorIdioma(destinatarios, async (idioma) => ({
      titulo: autor.nombre,
      cuerpo: await construirCuerpo(idioma),
      url: `/${idioma}/calendario`,
      datos: { tipo, evento_id: evento.id },
    }))
  } catch (err) {
    console.error(`[eventos] push ${tipo} falló:`, err)
  }
}

/** Push best-effort a la audiencia al **crear** un evento. */
export async function notificarEvento(userId: string, evento: EventoPush): Promise<void> {
  await enviarAAudiencia(userId, evento, 'evento', () => cuerpoDe(evento.titulo))
}

/**
 * Push best-effort al **editar** un evento con cambio material (D-edición). Copy
 * diferenciado ("Evento actualizado: …") y `tipo: 'evento_actualizado'` para que
 * la familia distinga una actualización de un evento nuevo. El caller decide si
 * hubo cambio material (`huboCambioMaterial`); aquí solo se envía.
 */
export async function notificarEdicionEvento(userId: string, evento: EventoPush): Promise<void> {
  await enviarAAudiencia(userId, evento, 'evento_actualizado', async (idioma) => {
    const t = await getTranslations({ locale: idioma, namespace: 'eventos' })
    return cuerpoDe(t('push.actualizado', { titulo: evento.titulo }))
  })
}

/**
 * Push de **cancelación** (D7): avisa a los tutores de los niños que YA habían
 * confirmado asistencia — no es un flip silencioso. Best-effort. El copy va
 * traducido al idioma de cada destinatario (antes era un «Cancelado:» fijo en
 * castellano para todos).
 */
export async function notificarCancelacion(
  userId: string,
  eventoId: string,
  titulo: string
): Promise<void> {
  try {
    const destinatarios = await tutoresDeNinosConfirmados(eventoId, userId)
    if (destinatarios.length === 0) return
    const autor = await getAutorPushInfo(userId)
    await enviarPushPorIdioma(destinatarios, async (idioma) => {
      const t = await getTranslations({ locale: idioma, namespace: 'eventos' })
      return {
        titulo: autor.nombre,
        cuerpo: cuerpoDe(t('push.cancelado', { titulo })),
        url: `/${idioma}/calendario`,
        datos: { tipo: 'evento_cancelado', evento_id: eventoId },
      }
    })
  } catch (err) {
    console.error('[eventos] push notificarCancelacion falló:', err)
  }
}
