import 'server-only'

import { logger } from '@/shared/lib/logger'

import type { PushPayload } from '../types'

import { idiomasDeUsuarios } from './audiencia'
import { enviarPushANotificarUsuarios } from './enviar-push'
import { IDIOMA_POR_DEFECTO, type Idioma } from './idioma'

type Resumen = Awaited<ReturnType<typeof enviarPushANotificarUsuarios>>

/**
 * Envía una notificación en el idioma de CADA destinatario (`usuarios.idioma_preferido`): el
 * título, el texto y el enlace (`/{idioma}/…`). Agrupa a los destinatarios por idioma, construye
 * la notificación una vez por idioma y hace un envío por grupo.
 *
 * Antes cada envío iba entero en el idioma del autor: la familia que tiene la app en castellano
 * recibía en valenciano el aviso que escribió la profe, y la página se le abría en valenciano.
 *
 * Cada grupo va por su cuenta: si uno falla (al construir su texto, por ejemplo), se anota y los
 * demás se envían igual; cuenta como error un aviso por usuario del grupo. No lanza nunca, como el
 * motor. Devuelve la suma de los resúmenes.
 */
export async function enviarPushPorIdioma(
  usuarioIds: string[],
  construir: (idioma: Idioma) => PushPayload | Promise<PushPayload>
): Promise<Resumen> {
  const total: Resumen = { enviados: 0, expirados: 0, errores: 0, total: 0 }
  if (usuarioIds.length === 0) return total

  const idiomas = await idiomasDeUsuarios(usuarioIds)
  const porIdioma = new Map<Idioma, string[]>()
  for (const id of usuarioIds) {
    const idioma = idiomas.get(id) ?? IDIOMA_POR_DEFECTO
    porIdioma.set(idioma, [...(porIdioma.get(idioma) ?? []), id])
  }

  for (const [idioma, ids] of porIdioma) {
    try {
      const r = await enviarPushANotificarUsuarios(ids, await construir(idioma))
      total.enviados += r.enviados
      total.expirados += r.expirados
      total.errores += r.errores
      total.total += r.total
    } catch (err) {
      logger.warn(
        `enviarPushPorIdioma: grupo ${idioma}`,
        err instanceof Error ? err.message : String(err)
      )
      total.errores += ids.length
    }
  }
  return total
}
