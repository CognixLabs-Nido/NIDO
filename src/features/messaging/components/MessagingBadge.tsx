'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'

import { getUnreadCountsAction } from '../actions/get-unread-counts'
import { useMessagingRealtime } from '../lib/use-messaging-realtime'
import { ContadorNoLeido } from '@/shared/components/ContadorNoLeido'

interface Props {
  /** Conteo inicial calculado server-side (evita el flash 0 al hidratar). */
  /** `null`: no se pudo contar (censo C): pinta «?», nunca un 0. */
  initialTotal: number | null
  /** Centro de la página: decide si el usuario cuenta como admin al recalcular. */
  centroId: string
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
export function MessagingBadge({ initialTotal, centroId }: Props) {
  const t = useTranslations('messages')
  const [total, setTotal] = useState<number | null>(initialTotal)

  const refresh = useCallback(async () => {
    try {
      const r = await getUnreadCountsAction(centroId)
      setTotal(r.total)
    } catch {
      // El badge no rompe la app, pero tampoco se queda con el número de antes (censo C, 2026-11-25):
      // si el recuento no llega, «?».
      setTotal(null)
    }
  }, [centroId])

  // El conteo inicial viene del SSR (layout). Realtime es la única fuente
  // de updates posteriores: cualquier insert/update en mensajes o anuncios
  // dispara un refresh asíncrono. Cuando el usuario navega entre páginas
  // del mismo layout, Next.js puede reutilizar el badge montado y la
  // suscripción Realtime sigue activa, así que el contador se mantiene
  // sincronizado sin necesidad de un fetch on-mount adicional.
  const onRealtimeChange = useCallback(() => {
    void refresh()
  }, [refresh])
  useMessagingRealtime({
    channel: 'messaging-badge-global',
    onChange: onRealtimeChange,
  })

  if (total === null) return <ContadorNoLeido />
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
