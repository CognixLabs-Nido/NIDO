'use client'

import { useMemo, useState, useTransition } from 'react'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { tipoResuelto } from '@/features/calendario-centro/lib/calendario-grid'
import { COLORES_TIPO } from '@/features/calendario-centro/lib/colores-tipo'
import type { OverrideMes } from '@/features/calendario-centro/types'
import { CalendarioMensual } from '@/shared/components/calendario/CalendarioMensual'

import { getEventoDetalleAction } from '../actions/get-evento-detalle'
import { indexarEventosPorDia, ymd } from '../lib/fecha-grid'
import type { EventoCalendario, EventoDetalle } from '../types'
import { EventoDetalleDialog } from './EventoDetalleDialog'

interface Props {
  mesInicial: number
  anioInicial: number
  overrides: OverrideMes[]
  eventos: EventoCalendario[]
  locale: 'es' | 'en' | 'va'
  esStaff: boolean
  esFamilia: boolean
}

/**
 * Calendario del centro con **overlay de eventos** (D10). Reusa
 * `<CalendarioMensual/>` y el coloreado de `dias_centro` de F4.5a; pinta los
 * eventos del día como chips. Click en un día → lista de sus eventos; click en
 * un evento → diálogo de detalle (carga roster/confirmación bajo demanda).
 */
export function CalendarioConEventos({
  mesInicial,
  anioInicial,
  overrides,
  eventos,
  locale,
  esStaff,
  esFamilia,
}: Props) {
  const t = useTranslations('eventos')
  const tCal = useTranslations('calendario')
  const router = useRouter()
  const [mes, setMes] = useState(mesInicial)
  const [anio, setAnio] = useState(anioInicial)
  const [diaSel, setDiaSel] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<EventoDetalle | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [, startTransition] = useTransition()

  const overrideMap = useMemo(
    () =>
      new Map(overrides.map((o) => [o.fecha, { tipo: o.tipo, observaciones: o.observaciones }])),
    [overrides]
  )
  const eventosPorDia = useMemo(() => indexarEventosPorDia(eventos), [eventos])

  const hoyYmd = useMemo(() => {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return fmt.format(new Date())
  }, [])

  const eventosDelDia = diaSel ? (eventosPorDia.get(diaSel) ?? []) : []

  function abrirDetalle(eventoId: string) {
    startTransition(async () => {
      const d = await getEventoDetalleAction(eventoId)
      if (!d) return
      setDetalle(d)
      setDialogOpen(true)
    })
  }

  function recargarDetalle() {
    if (!detalle) return
    const id = detalle.evento.id
    startTransition(async () => {
      const d = await getEventoDetalleAction(id)
      setDetalle(d)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <CalendarioMensual
        mes={mes}
        anio={anio}
        locale={locale}
        ariaLabel={t('calendario.aria')}
        labels={{ anterior: tCal('selector.anterior'), siguiente: tCal('selector.siguiente') }}
        onCambioMes={(m, a) => {
          setMes(m)
          setAnio(a)
          setDiaSel(null)
        }}
        onClickDia={(fecha) => setDiaSel(ymd(fecha))}
        diaActivo={diaSel ? new Date(`${diaSel}T00:00:00`) : null}
        renderDia={(fecha, dentroDelMes) => {
          const tipo = tipoResuelto(fecha, overrideMap)
          const cls = COLORES_TIPO[tipo].cell
          const evs = eventosPorDia.get(ymd(fecha)) ?? []
          return (
            <div
              data-tipo={tipo}
              className={`flex h-full flex-col gap-0.5 rounded-md border p-1 ${dentroDelMes ? cls : 'border-transparent bg-transparent'}`}
            >
              <span className="text-foreground text-sm font-medium">{fecha.getDate()}</span>
              {evs.slice(0, 2).map((ev) => (
                <span
                  key={ev.id}
                  className={`bg-primary-100 text-primary-800 truncate rounded px-1 text-[10px] ${ev.estado === 'cancelado' ? 'line-through opacity-60' : ''}`}
                  data-testid={`evento-chip-${ev.id}`}
                >
                  {ev.titulo}
                </span>
              ))}
              {evs.length > 2 && (
                <span className="text-muted-foreground text-[10px]">+{evs.length - 2}</span>
              )}
            </div>
          )
        }}
      />

      {diaSel && (
        <div className="space-y-2" data-testid="eventos-del-dia">
          <p className="text-muted-foreground text-sm font-medium">{diaSel}</p>
          {eventosDelDia.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('calendario.sin_eventos_dia')}</p>
          ) : (
            <ul className="space-y-1">
              {eventosDelDia.map((ev) => (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => abrirDetalle(ev.id)}
                    className="hover:bg-muted/60 border-border flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                    data-testid={`evento-item-${ev.id}`}
                  >
                    <span
                      className={`min-w-0 flex-1 truncate ${ev.estado === 'cancelado' ? 'line-through opacity-60' : ''}`}
                    >
                      {ev.titulo}
                    </span>
                    <span className="text-muted-foreground text-xs">{t(`tipos.${ev.tipo}`)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <EventoDetalleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        detalle={detalle}
        esStaff={esStaff}
        esFamilia={esFamilia}
        hoyYmd={hoyYmd}
        onChanged={recargarDetalle}
      />
    </div>
  )
}
