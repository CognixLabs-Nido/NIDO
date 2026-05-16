import { CalendarOffIcon } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'

import { getProximosDiasCerrados } from '../queries/get-proximos-dias-cerrados'

interface Props {
  centroId: string
}

const HORIZONTE_DIAS = 30

/**
 * Widget compacto para `/family` y `/teacher`: lista hasta 5 próximos
 * días cerrados (festivo / vacaciones / cerrado) en los próximos 30
 * días. Si no hay ninguno, empty state amable.
 *
 * No incluye sábados/domingos por default — solo overrides explícitos.
 * La directora marca lo que realmente quiere comunicar.
 */
export async function ProximosDiasCerradosWidget({ centroId }: Props) {
  const t = await getTranslations('calendario.widget_proximos_cerrados')
  const tTipos = await getTranslations('calendario.tipos')
  const locale = await getLocale()
  const items = await getProximosDiasCerrados(centroId, HORIZONTE_DIAS, 5)

  const fmt = new Intl.DateTimeFormat(
    locale === 'va' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES',
    { weekday: 'short', day: 'numeric', month: 'short' }
  )

  return (
    <Card data-testid="widget-proximos-cerrados">
      <CardContent className="space-y-3">
        <header className="flex items-center gap-2">
          <CalendarOffIcon className="text-accent-warm-600 size-5" />
          <h3 className="text-foreground font-semibold">{t('title')}</h3>
        </header>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="widget-empty">
            {t('vacio_amable')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((it) => (
              <li key={it.fecha} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-foreground font-medium capitalize">
                  {fmt.format(new Date(`${it.fecha}T00:00:00`))}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{tTipos(it.tipo)}</span>
                {it.observaciones && (
                  <span className="text-muted-foreground/80 truncate">· {it.observaciones}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
