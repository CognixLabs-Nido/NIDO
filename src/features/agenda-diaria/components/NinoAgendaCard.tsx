'use client'

import { ChevronDownIcon, ChevronRightIcon, HeartIcon, PillIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

import { fetchAgendaDelDia } from '../actions/fetch-agenda-del-dia'
import type { AgendaCompleta, NinoAgendaResumen } from '../types'

import { NinoAgendaPanel } from './NinoAgendaPanel'

interface Props {
  resumen: NinoAgendaResumen
  fecha: string
  diaCerrado: boolean
  expanded: boolean
  onToggle: () => void
  /** Cuando el padre detecta cambios de Realtime, bumpea este valor para
   * forzar a la card a recargar su agenda. */
  refreshKey: number
}

export function NinoAgendaCard({
  resumen,
  fecha,
  diaCerrado,
  expanded,
  onToggle,
  refreshKey,
}: Props) {
  const t = useTranslations('agenda')
  const initials =
    (resumen.nino.nombre.charAt(0) + (resumen.nino.apellidos.charAt(0) || '')).toUpperCase() || '?'
  const [agenda, setAgenda] = useState<AgendaCompleta | null>(null)

  const cargar = useCallback(() => {
    fetchAgendaDelDia(resumen.nino.id, fecha)
      .then((a) => setAgenda(a))
      .catch(() => setAgenda(null))
  }, [resumen.nino.id, fecha])

  useEffect(() => {
    if (expanded) cargar()
  }, [expanded, refreshKey, fecha, cargar])

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        className="hover:bg-muted/40 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`panel-${resumen.nino.id}`}
      >
        <div className="bg-primary-100 text-primary-700 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-foreground truncate text-sm font-medium">
            {resumen.nino.nombre} {resumen.nino.apellidos}
          </div>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2 text-xs">
            <span>
              🍽 {resumen.counts.comidas} · 🍼 {resumen.counts.biberones} · 😴{' '}
              {resumen.counts.suenos} · 🚼 {resumen.counts.deposiciones}
            </span>
            {resumen.alertas.alergia_grave && (
              <Badge variant="destructive">
                <HeartIcon />
                {t('alertas.alergia_grave')}
              </Badge>
            )}
            {resumen.alertas.medicacion && (
              <Badge variant="warning">
                <PillIcon />
                {t('alertas.medicacion')}
              </Badge>
            )}
          </div>
        </div>
        {expanded ? (
          <ChevronDownIcon className="text-muted-foreground size-5" />
        ) : (
          <ChevronRightIcon className="text-muted-foreground size-5" />
        )}
      </button>
      {expanded && (
        <CardContent id={`panel-${resumen.nino.id}`} className="pt-0">
          <NinoAgendaPanel
            key={resumen.nino.id}
            resumen={resumen}
            fecha={fecha}
            diaCerrado={diaCerrado}
            agenda={agenda}
          />
        </CardContent>
      )}
    </Card>
  )
}
