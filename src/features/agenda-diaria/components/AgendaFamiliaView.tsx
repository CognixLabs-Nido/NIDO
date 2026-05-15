'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { hoyMadrid } from '../lib/fecha'
import { useAgendaRealtime } from '../lib/use-agenda-realtime'
import { esAnulado } from '../schemas/agenda-diaria'
import type { AgendaCompleta } from '../types'

import { AgendaDayPicker } from './AgendaDayPicker'

interface Props {
  ninoId: string
  locale: string
  fecha: string
  agenda: AgendaCompleta
}

/**
 * Vista familia: solo lectura. Day picker para histórico, secciones con
 * conteo y detalle. Realtime activo únicamente si fecha == hoy (en
 * histórico no aporta nada y consume canal).
 */
export function AgendaFamiliaView({ ninoId, locale, fecha, agenda }: Props) {
  const t = useTranslations('agenda')
  const tFam = useTranslations('family.nino.agenda')
  const router = useRouter()

  const hoy = hoyMadrid()
  const esElDiaActual = fecha === hoy
  const agendaId = agenda.cabecera?.id ?? null

  function setFecha(nueva: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('fecha', nueva)
    router.push(url.pathname + url.search)
  }

  useAgendaRealtime({
    channel: `agenda-nino-${ninoId}`,
    ninoIds: [ninoId],
    agendaIds: agendaId ? [agendaId] : [],
    enabled: esElDiaActual,
  })

  const sinRegistros =
    !agenda.cabecera &&
    agenda.comidas.length === 0 &&
    agenda.biberones.length === 0 &&
    agenda.suenos.length === 0 &&
    agenda.deposiciones.length === 0

  return (
    <div className="space-y-4" aria-label={t('title')}>
      <AgendaDayPicker
        fecha={fecha}
        locale={locale}
        onChange={setFecha}
        diaCerrado={!esElDiaActual}
        hoy={hoy}
      />

      {sinRegistros ? (
        <Card>
          <CardContent className="text-muted-foreground py-6 text-center text-sm">
            {tFam('historico_vacio')}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {/* General */}
          {agenda.cabecera && (
            <Card>
              <CardContent className="space-y-2 text-sm">
                <h3 className="text-foreground font-medium">{t('secciones.general')}</h3>
                {agenda.cabecera.estado_general && (
                  <p>
                    <span className="text-muted-foreground">{t('campos.estado_general')}:</span>{' '}
                    {t(`estado_general_opciones.${agenda.cabecera.estado_general}`)}
                  </p>
                )}
                {agenda.cabecera.humor && (
                  <p>
                    <span className="text-muted-foreground">{t('campos.humor')}:</span>{' '}
                    {t(`humor_opciones.${agenda.cabecera.humor}`)}
                  </p>
                )}
                {agenda.cabecera.observaciones_generales && (
                  <p className="text-foreground break-words">
                    {agenda.cabecera.observaciones_generales}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Comidas */}
          {agenda.comidas.length > 0 && (
            <Card>
              <CardContent className="space-y-2 text-sm">
                <h3 className="text-foreground font-medium">
                  {t('secciones.comidas')} · {agenda.comidas.length}
                </h3>
                <ul className="space-y-1.5">
                  {agenda.comidas.map((c) => {
                    const anulado = esAnulado(c.observaciones)
                    return (
                      <li
                        key={c.id}
                        className={cn('flex flex-wrap items-center gap-2', anulado && 'opacity-50')}
                        data-testid={`fam-comida-${c.id}`}
                      >
                        {anulado && <Badge variant="secondary">{t('estado.anulado')}</Badge>}
                        <Badge variant="warm">{t(`momento_opciones.${c.momento}`)}</Badge>
                        {c.hora && <span className="font-mono text-xs">{c.hora.slice(0, 5)}</span>}
                        <span className={cn(anulado && 'line-through')}>
                          {t(`cantidad_comida_opciones.${c.cantidad}`)}
                        </span>
                        {c.descripcion && (
                          <span className={cn('text-muted-foreground', anulado && 'line-through')}>
                            · {c.descripcion}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Biberones */}
          {agenda.biberones.length > 0 && (
            <Card>
              <CardContent className="space-y-2 text-sm">
                <h3 className="text-foreground font-medium">
                  {t('secciones.biberones')} · {agenda.biberones.length}
                </h3>
                <ul className="space-y-1.5">
                  {agenda.biberones.map((b) => {
                    const anulado = esAnulado(b.observaciones)
                    return (
                      <li
                        key={b.id}
                        className={cn('flex flex-wrap items-center gap-2', anulado && 'opacity-50')}
                        data-testid={`fam-biberon-${b.id}`}
                      >
                        {anulado && <Badge variant="secondary">{t('estado.anulado')}</Badge>}
                        <span className="font-mono text-xs">{b.hora.slice(0, 5)}</span>
                        <Badge variant="info">{t(`tipo_biberon_opciones.${b.tipo}`)}</Badge>
                        <span className={cn(anulado && 'line-through')}>{b.cantidad_ml} ml</span>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Sueños */}
          {agenda.suenos.length > 0 && (
            <Card>
              <CardContent className="space-y-2 text-sm">
                <h3 className="text-foreground font-medium">
                  {t('secciones.suenos')} · {agenda.suenos.length}
                </h3>
                <ul className="space-y-1.5">
                  {agenda.suenos.map((s) => {
                    const anulado = esAnulado(s.observaciones)
                    return (
                      <li
                        key={s.id}
                        className={cn('flex flex-wrap items-center gap-2', anulado && 'opacity-50')}
                        data-testid={`fam-sueno-${s.id}`}
                      >
                        {anulado && <Badge variant="secondary">{t('estado.anulado')}</Badge>}
                        <span className={cn('font-mono text-xs', anulado && 'line-through')}>
                          {s.hora_inicio.slice(0, 5)}–{s.hora_fin ? s.hora_fin.slice(0, 5) : '...'}
                        </span>
                        {s.calidad && (
                          <Badge variant="warm">{t(`calidad_sueno_opciones.${s.calidad}`)}</Badge>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Deposiciones */}
          {agenda.deposiciones.length > 0 && (
            <Card>
              <CardContent className="space-y-2 text-sm">
                <h3 className="text-foreground font-medium">
                  {t('secciones.deposiciones')} · {agenda.deposiciones.length}
                </h3>
                <ul className="space-y-1.5">
                  {agenda.deposiciones.map((d) => {
                    const anulado = esAnulado(d.observaciones)
                    return (
                      <li
                        key={d.id}
                        className={cn('flex flex-wrap items-center gap-2', anulado && 'opacity-50')}
                        data-testid={`fam-deposicion-${d.id}`}
                      >
                        {anulado && <Badge variant="secondary">{t('estado.anulado')}</Badge>}
                        {d.hora && <span className="font-mono text-xs">{d.hora.slice(0, 5)}</span>}
                        <Badge variant="info">{t(`tipo_deposicion_opciones.${d.tipo}`)}</Badge>
                        <span className={cn(anulado && 'line-through')}>
                          {t(`cantidad_deposicion_opciones.${d.cantidad}`)}
                        </span>
                        {d.consistencia && (
                          <span className={cn('text-muted-foreground', anulado && 'line-through')}>
                            · {t(`consistencia_opciones.${d.consistencia}`)}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
