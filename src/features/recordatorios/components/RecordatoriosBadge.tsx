'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'

import { getRecordatoriosPendientesCountAction } from '../actions/get-pendientes-count-action'
import { useRecordatoriosRealtime } from '../lib/use-recordatorios-realtime'

interface Props {
  /** Conteo inicial calculado server-side (evita el flash 0 al hidratar). */
  initialTotal: number
}

/**
 * Badge global de recordatorios PENDIENTES dirigidos al usuario como
 * destinatario directo (D7). Se monta en el item "Recordatorios" del sidebar
 * de cada rol. Mirror de `MessagingBadge`: estado inicial SSR + una suscripción
 * Realtime a `recordatorios` que re-consulta el RPC ante cualquier cambio
 * visible. La RLS de SELECT filtra los eventos Realtime, así que el cliente
 * solo se entera de filas que puede leer.
 */
export function RecordatoriosBadge({ initialTotal }: Props) {
  const t = useTranslations('recordatorios')
  const [total, setTotal] = useState(initialTotal)

  const refresh = useCallback(async () => {
    try {
      const r = await getRecordatoriosPendientesCountAction()
      setTotal(r.total)
    } catch {
      // Error silencioso: el badge no debe romper la app si la consulta falla.
    }
  }, [])

  const onRealtimeChange = useCallback(() => {
    void refresh()
  }, [refresh])
  useRecordatoriosRealtime({ channel: 'recordatorios-badge-global', onChange: onRealtimeChange })

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
