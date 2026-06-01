import 'server-only'

import { getAutorPushInfo } from '@/features/push/lib/audiencia'
import { enviarPushANotificarUsuarios } from '@/features/push/lib/enviar-push'

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
 * Push best-effort a la audiencia del evento (crear/editar). No lanza nunca: un
 * fallo de push no rompe la operación (el evento ya está persistido).
 */
export async function notificarEvento(userId: string, evento: EventoPush): Promise<void> {
  try {
    const destinatarios = await audienciaPushEvento(evento, userId)
    if (destinatarios.length === 0) return
    const autor = await getAutorPushInfo(userId)
    await enviarPushANotificarUsuarios(destinatarios, {
      titulo: autor.nombre,
      cuerpo: cuerpoDe(evento.titulo),
      url: `/${autor.idioma}/calendario`,
      datos: { tipo: 'evento', evento_id: evento.id },
    })
  } catch (err) {
    console.error('[eventos] push notificarEvento falló:', err)
  }
}

/**
 * Push de **cancelación** (D7): avisa a los tutores de los niños que YA habían
 * confirmado asistencia — no es un flip silencioso. Best-effort.
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
    await enviarPushANotificarUsuarios(destinatarios, {
      titulo: autor.nombre,
      cuerpo: cuerpoDe(`Cancelado: ${titulo}`),
      url: `/${autor.idioma}/calendario`,
      datos: { tipo: 'evento_cancelado', evento_id: eventoId },
    })
  } catch (err) {
    console.error('[eventos] push notificarCancelacion falló:', err)
  }
}
