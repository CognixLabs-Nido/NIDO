'use client'

import {
  ChevronDownIcon,
  ChevronRightIcon,
  HeartIcon,
  MessageCircleIcon,
  PillIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EscribirAFamiliaAdminPicker } from '@/features/messaging/components/EscribirAFamiliaAdminPicker'
import type { VinculoTutorMin } from '@/features/messaging/queries/get-vinculos-tutores-aula'

import { fetchAgendaDelDia } from '../actions/fetch-agenda-del-dia'
import type { AgendaCompleta, NinoAgendaResumen } from '../types'

import { NinoAgendaPanel } from './NinoAgendaPanel'

interface Props {
  resumen: NinoAgendaResumen
  fecha: string
  locale: string
  diaCerrado: boolean
  expanded: boolean
  onToggle: () => void
  /** Cuando el padre detecta cambios de Realtime, bumpea este valor para
   * forzar a la card a recargar su agenda. */
  refreshKey: number
  /** F5B-#33 — Rol del usuario actual en el centro. Distingue el flujo
   *  del botón "Escribir a la familia": para `admin` se renderiza el
   *  `EscribirAFamiliaAdminPicker` (Dialog si hay ≥2 tutores) que
   *  redirige al SplitView del PR #32 con tutor preseleccionado. Para
   *  `profe` se mantiene el `<Link>` legacy bit-a-bit al redirector
   *  `/messages/nino/<id>`. */
  rol: 'admin' | 'profe' | 'tutor_legal' | 'autorizado'
  /** F5B-#33 — Solo poblado cuando `rol === 'admin'`. Vínculos
   *  activos (tutor/autorizado) del niño en el centro, para alimentar
   *  el picker. La página SSR los carga vía
   *  `getVinculosTutoresAula(aulaId)` paralelo a la agenda. */
  vinculos?: VinculoTutorMin[]
}

export function NinoAgendaCard({
  resumen,
  fecha,
  locale,
  diaCerrado,
  expanded,
  onToggle,
  refreshKey,
  rol,
  vinculos,
}: Props) {
  const t = useTranslations('agenda')
  const tFicha = useTranslations('messages.ficha_nino')
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
      {/*
        Dos elementos hermanos en lugar de un único <button> que ocupe toda
        la fila: el botón <Link> "Escribir a la familia" no puede anidarse
        dentro de un <button> (HTML inválido, no se renderiza como link
        clicable). Mantenemos el toggle expandiendo solo la zona principal
        y exponemos el Link a la derecha.
      */}
      <div className="flex items-stretch">
        <button
          type="button"
          className="hover:bg-muted/40 flex flex-1 items-center gap-3 px-4 py-3 text-left transition-colors"
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
        {rol === 'admin' ? (
          // F5B-#33: para admin, picker → SplitView con tutor preseleccionado.
          <EscribirAFamiliaAdminPicker
            ninoId={resumen.nino.id}
            vinculos={vinculos ?? []}
            locale={locale}
          />
        ) : (
          // Profe (y resto de roles que puedan llegar a esta vista): Link
          // legacy bit-a-bit al redirector /messages/nino/<id>. Cero
          // cambio funcional respecto al estado pre-#33.
          <Link
            href={`/${locale}/messages/nino/${resumen.nino.id}`}
            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground flex shrink-0 items-center gap-1 border-l px-3 text-xs font-medium transition-colors"
            aria-label={tFicha('escribir_familia')}
            data-testid="escribir-familia-button"
          >
            <MessageCircleIcon className="size-4" />
            <span className="hidden sm:inline">{tFicha('escribir_familia')}</span>
          </Link>
        )}
      </div>
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
