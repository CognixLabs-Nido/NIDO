import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getTranslations } from 'next-intl/server'

import { urlDelAviso } from '@/features/centros/contexto/centro-del-aviso'
import { titularesDelCentro } from '@/features/centros/contexto/roles-de-otros'
import { idiomasDeUsuarios } from '@/features/push/lib/audiencia'
import { enviarPushPorIdioma } from '@/features/push/lib/enviar-por-idioma'
import { IDIOMA_POR_DEFECTO } from '@/features/push/lib/idioma'
import { getAppUrl } from '@/shared/lib/app-url'
import { enviarCorreo } from '@/shared/lib/correo/enviar-correo'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

type Service = SupabaseClient<Database>

/** Cada cambio de una petición de olvido del que se avisa a la familia (spec, «Avisos»). */
export type EventoOlvido =
  | 'pedida'
  | 'confirmada'
  | 'rechazada'
  | 'retirada'
  | 'deshecha'
  | 'borrada'

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Un correo ya redactado, listo para enviar. */
export interface CorreoAviso {
  para: string
  asunto: string
  texto: string
  html: string
}

/**
 * Los correos a la familia por un cambio de su petición: a quien la pidió (si no fue el centro), a
 * los tutores legales del niño o a la propia persona (`olvido_destinatarios`). Cada uno en su
 * idioma.
 *
 * No nombra al niño ni a nadie: dice el centro y lleva al perfil, donde está el detalle. Solo los
 * redacta: la purga los prepara antes de borrar, mientras aún se conoce la dirección, y los envía
 * después. Nunca lanza: sin destinatarios, ninguno.
 */
export async function prepararAvisoFamilia(
  service: Service,
  solicitudId: string,
  evento: EventoOlvido
): Promise<CorreoAviso[]> {
  try {
    const { data: destinos, error } = await service.rpc('olvido_destinatarios', {
      p_solicitud_id: solicitudId,
    })
    if (error) {
      logger.warn('olvido: destinatarios del aviso', error.message)
      return []
    }
    const ids = (destinos ?? []).map((d) => d.usuario_id)
    if (ids.length === 0) return []

    const { data: solicitud } = await service
      .from('olvido_solicitudes')
      .select('centro_id')
      .eq('id', solicitudId)
      .maybeSingle()
    const { data: centro } = solicitud
      ? await service.from('centros').select('nombre').eq('id', solicitud.centro_id).maybeSingle()
      : { data: null }
    const idiomas = await idiomasDeUsuarios(ids)

    const correos: CorreoAviso[] = []
    for (const id of ids) {
      const { data: cuenta } = await service.auth.admin.getUserById(id)
      const email = cuenta?.user?.email
      if (!email) continue
      const idioma = idiomas.get(id) ?? IDIOMA_POR_DEFECTO
      const t = await getTranslations({ locale: idioma, namespace: 'olvido.correo' })
      const enlace = `${getAppUrl()}/${idioma}/profile`
      const texto = t(`texto_${evento}`, { centro: centro?.nombre ?? '' })
      const cuerpo = [t('saludo'), '', texto, '', `${t('boton')}: ${enlace}`].join('\n')
      const html = `<div style="font-family: Helvetica, Arial, sans-serif; color: #3d4450; max-width: 480px">
  <p style="font-size: 22px; font-weight: 700; color: #1f7a5c">NIDO</p>
  <p>${escaparHtml(t('saludo'))}</p>
  <p>${escaparHtml(texto)}</p>
  <p><a href="${escaparHtml(enlace)}" style="display: inline-block; padding: 12px 24px; background-color: #1f7a5c; color: #ffffff; text-decoration: none; border-radius: 8px">${escaparHtml(t('boton'))}</a></p>
</div>`
      correos.push({ para: email, asunto: t('asunto'), texto: cuerpo, html })
    }
    return correos
  } catch (err) {
    logger.warn('olvido: aviso a la familia', err instanceof Error ? err.message : String(err))
    return []
  }
}

/** Envía los correos ya redactados. Nunca lanza: un correo que no sale no deshace nada. */
export async function enviarAvisos(correos: CorreoAviso[]): Promise<number> {
  let enviados = 0
  for (const correo of correos) {
    try {
      const r = await enviarCorreo(correo)
      if (r.enviado) enviados++
    } catch (err) {
      logger.warn('olvido: aviso a la familia', err instanceof Error ? err.message : String(err))
    }
  }
  return enviados
}

/** Redacta y envía en el momento. Devuelve cuántos salieron. */
export async function avisarFamilia(
  service: Service,
  solicitudId: string,
  evento: EventoOlvido
): Promise<number> {
  return enviarAvisos(await prepararAvisoFamilia(service, solicitudId, evento))
}

/**
 * Push a la titular del centro por una petición nueva: genérica, sin nombres (la notificación se
 * ve en la pantalla bloqueada, F11-B punto 8). Nunca lanza.
 */
export async function avisarTitular(service: Service, centroId: string): Promise<void> {
  try {
    const ids = await titularesDelCentro(service, centroId)
    await enviarPushPorIdioma(ids, async (idioma) => {
      const t = await getTranslations({ locale: idioma, namespace: 'push.notificaciones' })
      return {
        titulo: t('olvido_titulo'),
        cuerpo: t('olvido_cuerpo'),
        url: urlDelAviso(`/${idioma}/admin/olvido`, centroId),
        datos: { tipo: 'peticion_olvido' },
      }
    })
  } catch (err) {
    logger.warn('olvido: aviso a la titular', err instanceof Error ? err.message : String(err))
  }
}
