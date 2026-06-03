import { CalendarOffIcon, CalendarRangeIcon, UsersIcon } from 'lucide-react'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import type { LucideIcon } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { getResumenSemana } from '../queries/get-resumen-semana'
import type { ResumenItem } from '../types'

interface Props {
  centroId: string
  /** Ruta de la Agenda (compartida): `/${locale}/agenda`. */
  agendaHref: string
  /** Ruta del Calendario Escolar (por rol): `/${locale}/{rol}/calendario`. */
  calendarioHref: string
}

const ICONO: Record<ResumenItem['kind'], LucideIcon> = {
  evento: CalendarRangeIcon,
  cita: UsersIcon,
  cierre: CalendarOffIcon,
}

const COLOR: Record<ResumenItem['kind'], string> = {
  evento: 'text-info-700',
  cita: 'text-primary-700',
  cierre: 'text-accent-warm-600',
}

/**
 * Resumen del día + la semana ISO en curso para la pestaña de Inicio (AG-15):
 * integra eventos del Calendario Escolar, citas de la Agenda y cierres del centro
 * en dos secciones (Hoy / Esta semana). Solo lee y pinta — el ámbito por rol lo
 * da la RLS; el detalle vive en `/calendario` y `/agenda` (enlaces "ver todo").
 */
export async function ResumenSemanaWidget({ centroId, agendaHref, calendarioHref }: Props) {
  const t = await getTranslations('inicio_resumen')
  const tCita = await getTranslations('agenda.tipos')
  const tEvento = await getTranslations('eventos.tipos')
  const tCierre = await getTranslations('calendario.tipos')
  const locale = await getLocale()
  const { hoy, semana } = await getResumenSemana(centroId)

  const fmt = new Intl.DateTimeFormat(
    locale === 'va' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES',
    { weekday: 'short', day: 'numeric', month: 'short' }
  )

  function tipoLabel(item: ResumenItem): string {
    if (item.kind === 'cita') return tCita(item.tipo)
    if (item.kind === 'evento') return tEvento(item.tipo)
    return tCierre(item.tipo)
  }

  function fila(item: ResumenItem, mostrarFecha: boolean) {
    const Icon = ICONO[item.kind]
    const tipo = tipoLabel(item)
    const titulo = item.titulo ?? tipo
    const href = item.kind === 'cita' ? agendaHref : calendarioHref
    const cuando = `${mostrarFecha ? `${fmt.format(new Date(`${item.fecha}T00:00:00`))} · ` : ''}${item.hora ?? t('todo_el_dia')}`
    return (
      <li key={`${item.kind}:${item.id}`}>
        <Link
          href={href}
          className="hover:bg-muted/50 focus-visible:ring-ring -mx-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition focus-visible:ring-2 focus-visible:outline-none"
        >
          <Icon className={cn('size-4 shrink-0', COLOR[item.kind])} />
          <span className="text-muted-foreground shrink-0 capitalize tabular-nums">{cuando}</span>
          <span className="text-foreground truncate font-medium">{titulo}</span>
          {item.titulo && <span className="text-muted-foreground shrink-0">· {tipo}</span>}
        </Link>
      </li>
    )
  }

  const vacioTotal = hoy.length === 0 && semana.length === 0

  return (
    <Card data-testid="widget-resumen-semana">
      <CardContent className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-foreground font-semibold">{t('title')}</h3>
          <div className="flex gap-3 text-xs font-medium">
            <Link href={agendaHref} className="text-primary-700 hover:text-primary-800">
              {t('ver_agenda')}
            </Link>
            <Link href={calendarioHref} className="text-info-700 hover:text-info-800">
              {t('ver_calendario')}
            </Link>
          </div>
        </header>

        {vacioTotal ? (
          <p className="text-muted-foreground text-sm" data-testid="resumen-vacio">
            {t('vacio_total')}
          </p>
        ) : (
          <div className="space-y-4">
            <section className="space-y-1.5">
              <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {t('hoy')}
              </h4>
              {hoy.length === 0 ? (
                <p className="text-muted-foreground/80 text-sm">{t('vacio_hoy')}</p>
              ) : (
                <ul>{hoy.map((it) => fila(it, false))}</ul>
              )}
            </section>

            <section className="space-y-1.5">
              <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {t('resto_semana')}
              </h4>
              {semana.length === 0 ? (
                <p className="text-muted-foreground/80 text-sm">{t('vacio_semana')}</p>
              ) : (
                <ul>{semana.map((it) => fila(it, true))}</ul>
              )}
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
