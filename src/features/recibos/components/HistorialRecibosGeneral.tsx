import { ChevronRightIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { formatEuros } from '@/shared/lib/format-money'

import {
  BADGE_ESTADO_HISTORIAL,
  HistoriaCobro,
  hrefRecibo,
  tituloRecibo,
} from './HistorialRecibosFamilia'

import type { ReciboHistorialGeneral } from '../queries/get-historial-recibos-general'

/**
 * Una página del histórico general de recibos (F-6): como el histórico de la ficha, con la familia
 * de cada recibo enlazada a su ficha. El título abre el recibo y los recibos enlazados también.
 */
export function HistorialRecibosGeneral({
  recibos,
  locale,
}: {
  recibos: ReciboHistorialGeneral[]
  locale: string
}) {
  const t = useTranslations('admin.familias.recibos')
  return (
    <Card className="overflow-hidden">
      <ul className="divide-border/60 divide-y">
        {recibos.map((r) => (
          <li key={r.id} className="space-y-1 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {r.familiaId ? (
                <Link
                  href={hrefRecibo(locale, r.familiaId, r.id)}
                  className="text-foreground inline-flex items-center gap-1 font-medium hover:underline"
                >
                  {tituloRecibo(r, locale)}
                  <ChevronRightIcon className="text-muted-foreground size-4" />
                </Link>
              ) : (
                <span className="text-foreground font-medium">{tituloRecibo(r, locale)}</span>
              )}
              {r.familiaId && (
                <Link
                  href={`/${locale}/admin/familias/${r.familiaId}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {r.familiaEtiqueta ?? '—'}
                </Link>
              )}
              {r.tipo !== 'mensual' && <Badge variant="outline">{t(`tipo.${r.tipo}`)}</Badge>}
              <Badge variant={BADGE_ESTADO_HISTORIAL[r.estado]}>{t(`estado.${r.estado}`)}</Badge>
              <span className="ml-auto font-medium tabular-nums">
                {formatEuros(r.totalCentimos, locale)}
              </span>
            </div>
            {r.familiaId && <HistoriaCobro recibo={r} familiaId={r.familiaId} locale={locale} />}
          </li>
        ))}
      </ul>
    </Card>
  )
}
