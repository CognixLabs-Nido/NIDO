import { CoinsIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { MarcarRecibosVistosOnMount } from '@/features/notificaciones/components/MarcarRecibosVistosOnMount'
import { ESTADO_BADGE_VARIANT, formatPeriodo } from '@/features/recibos/lib/formato'
import { getRecibosFamilia, idsDeRecibos } from '@/features/recibos/queries/get-recibos-familia'
import { EmptyState } from '@/shared/components/EmptyState'
import { formatEuros } from '@/shared/lib/format-money'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * Recibos — vista de familia (F12-B-7). Lista los recibos PASADOS de cada hijo del tutor
 * legal, agrupados por niño y ordenados por período (más reciente primero). Solo lectura:
 * cada recibo enlaza a su detalle con el desglose de líneas. La RLS garantiza que nunca
 * aparecen recibos de otros niños. Al montar, marca todos como vistos (baja el aviso de
 * "recibos nuevos" del inicio).
 */
export default async function FamilyRecibosPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('recibos')
  const grupos = await getRecibosFamilia()
  const ids = idsDeRecibos(grupos)

  return (
    <div className="space-y-8">
      <MarcarRecibosVistosOnMount reciboIds={ids} />
      <header className="space-y-2">
        <h1 className="text-h1 text-foreground flex items-center gap-2">
          <CoinsIcon className="text-primary-600 size-7" />
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('family_intro')}</p>
      </header>

      {grupos.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<CoinsIcon strokeWidth={1.75} />}
              title={t('family_sin_recibos')}
              description={t('family_sin_recibos_desc')}
            />
          </CardContent>
        </Card>
      ) : (
        grupos.map((nino) => (
          <section key={nino.ninoId} className="space-y-3">
            <h2 className="text-h2 text-foreground">{nino.nombre}</h2>
            <div className="divide-y rounded-md border">
              {nino.recibos.map((r) => (
                <Link
                  key={r.id}
                  href={`/${locale}/family/recibos/${r.id}`}
                  className="hover:bg-muted/50 focus-visible:ring-ring flex flex-wrap items-center justify-between gap-3 p-3 text-sm transition focus-visible:ring-2 focus-visible:outline-none"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {r.esEsporadico && r.conceptoEsporadico
                        ? r.conceptoEsporadico
                        : formatPeriodo(r.anio, r.mes, locale)}
                    </span>
                    <Badge variant={ESTADO_BADGE_VARIANT[r.estado]}>
                      {t(`estado_recibo.${r.estado}`)}
                    </Badge>
                    {r.esEsporadico && <Badge variant="outline">{t('esporadico_badge')}</Badge>}
                    {r.esRegiro && <Badge variant="outline">{t('regiro_badge')}</Badge>}
                  </div>
                  <span className="font-medium tabular-nums">{formatEuros(r.totalCentimos)}</span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
