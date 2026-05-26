'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'

import { getUnreadCountsAction } from '../actions/get-unread-counts'
import { useMessagingRealtime } from '../lib/use-messaging-realtime'

interface Props {
  /** Conteo inicial calculado server-side (evita el flash 0 al hidratar). */
  initialTotal: number
}

/**
 * Badge global de no leídos. Visible en TODA pantalla logueada porque
 * se monta dentro del SidebarNav del layout root de cada rol (admin,
 * teacher, family). Subscription Realtime abierta durante toda la
 * sesión: cualquier mensaje o anuncio recibido vía RLS dispara una
 * re-consulta del conteo.
 *
 * Realtime + RLS: el cliente solo recibe eventos sobre filas que su
 * rol puede leer. `puede_recibir_mensajes=false` ⇒ no recibe nada
 * ⇒ badge siempre a 0.
 */
export function MessagingBadge({ initialTotal }: Props) {
  const t = useTranslations('messages')
  const [total, setTotal] = useState(initialTotal)

  const refresh = useCallback(async () => {
    try {
      const r = await getUnreadCountsAction()
      setTotal(r.total)
    } catch {
      // Error silencioso: el badge no debe romper la app si la consulta falla.
    }
  }, [])

  // El conteo inicial viene del SSR (layout). Realtime es la única fuente
  // de updates posteriores: cualquier insert/update en mensajes o anuncios
  // dispara un refresh asíncrono. Cuando el usuario navega entre páginas
  // del mismo layout, Next.js puede reutilizar el badge montado y la
  // suscripción Realtime sigue activa, así que el contador se mantiene
  // sincronizado sin necesidad de un fetch on-mount adicional.
  useMessagingRealtime({
    channel: 'messaging-badge-global',
    onChange: () => {
      void refresh()
    },
  })

  if (total <= 0) return null

  const label = t('badge_aria', { n: total })

  return (
    <Badge
      variant="default"
      className="ml-auto px-1.5 text-[10px]"
      aria-label={label}
      title={label}
    >
      {total > 9 ? '9+' : total}
    </Badge>
  )
}
