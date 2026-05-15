'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'

import { BabyIcon } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { EmptyState } from '@/shared/components/EmptyState'

import { hoyMadrid } from '../lib/fecha'
import { useAgendaRealtime } from '../lib/use-agenda-realtime'
import type { NinoAgendaResumen } from '../types'

import { AgendaDayPicker } from './AgendaDayPicker'
import { NinoAgendaCard } from './NinoAgendaCard'

interface Props {
  aulaId: string
  locale: string
  fecha: string
  resumenes: NinoAgendaResumen[]
}

export function AgendaAulaCliente({ aulaId, locale, fecha, resumenes }: Props) {
  const t = useTranslations('agenda')
  const tAula = useTranslations('teacher.aula')
  const router = useRouter()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const hoy = hoyMadrid()
  const diaCerrado = fecha !== hoy

  function setFecha(nueva: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('fecha', nueva)
    router.push(url.pathname + url.search)
  }

  const ninoIds = resumenes.map((r) => r.nino.id)
  const agendaIds = resumenes.map((r) => r.agenda_id).filter((a): a is string => a !== null)

  const onRealtimeChange = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  useAgendaRealtime({
    channel: `agenda-aula-${aulaId}`,
    ninoIds,
    agendaIds,
    enabled: true,
    onChange: onRealtimeChange,
  })

  return (
    <div className="space-y-4">
      <AgendaDayPicker
        fecha={fecha}
        locale={locale}
        onChange={setFecha}
        diaCerrado={diaCerrado}
        hoy={hoy}
      />
      {resumenes.length === 0 ? (
        <Card>
          <EmptyState icon={<BabyIcon strokeWidth={1.75} />} title={tAula('ningun_nino')} />
        </Card>
      ) : (
        <ul className="space-y-2" aria-label={t('title')}>
          {resumenes.map((r) => (
            <li key={r.nino.id}>
              <NinoAgendaCard
                resumen={r}
                fecha={fecha}
                diaCerrado={diaCerrado}
                expanded={expanded === r.nino.id}
                onToggle={() => setExpanded(expanded === r.nino.id ? null : r.nino.id)}
                refreshKey={refreshKey}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
