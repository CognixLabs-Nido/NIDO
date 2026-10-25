import { ChevronLeftIcon, ReceiptIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { getFamiliaDetalle } from '@/features/familias/queries/get-familia-detalle'
import { DesgloseRecibo } from '@/features/recibos/components/DesgloseRecibo'
import {
  BADGE_ESTADO_HISTORIAL,
  HistoriaCobro,
  tituloRecibo,
} from '@/features/recibos/components/HistorialRecibosFamilia'
import { getReciboAdminDetalle } from '@/features/recibos/queries/get-recibo-admin-detalle'
import { formatEuros } from '@/shared/lib/format-money'

interface PageProps {
  params: Promise<{ id: string; reciboId: string; locale: string }>
}

/**
 * F-6 — un recibo de la familia, para Dirección: su estado, lo que pasó al cobrarlo (con los
 * recibos enlazados) y el desglose por hijo. También el borrador. El recibo tiene que ser de esa
 * familia y del centro de la página; si no, notFound.
 */
export default async function ReciboFamiliaAdminPage({ params }: PageProps) {
  const { id, reciboId, locale } = await params
  const t = await getTranslations('admin.familias.recibos')
  const { centroId } = await requireContextoCentro(locale)
  const familia = await getFamiliaDetalle(id, centroId)
  if (!familia) notFound()

  const detalle = await getReciboAdminDetalle(reciboId, familia.id, centroId)
  if (!detalle.ok && detalle.motivo === 'no_encontrado') notFound()

  const volver = (
    <Link
      href={`/${locale}/admin/familias/${familia.id}`}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
    >
      <ChevronLeftIcon className="size-4" />
      {t('volver')}
    </Link>
  )

  if (!detalle.ok) {
    return (
      <div className="space-y-6">
        {volver}
        <Card>
          <CardContent className="text-warm-800 pt-1 text-sm">{t('error_detalle')}</CardContent>
        </Card>
      </div>
    )
  }

  const { recibo, desglose } = detalle
  const sinLineas = desglose.gruposHijo.length === 0 && desglose.lineasFamiliares.length === 0

  return (
    <div className="space-y-6">
      {volver}

      <header className="bg-card border-border/60 space-y-2 rounded-2xl border p-5 shadow-md">
        <p className="text-muted-foreground text-sm">{familia.etiqueta ?? '—'}</p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-h2 text-foreground flex items-center gap-2">
            <ReceiptIcon className="text-muted-foreground size-5" />
            {tituloRecibo(recibo, locale)}
          </h1>
          {recibo.tipo !== 'mensual' && <Badge variant="outline">{t(`tipo.${recibo.tipo}`)}</Badge>}
          <Badge variant={BADGE_ESTADO_HISTORIAL[recibo.estado]}>
            {t(`estado.${recibo.estado}`)}
          </Badge>
          <span className="ml-auto text-lg font-semibold tabular-nums">
            {formatEuros(recibo.totalCentimos, locale)}
          </span>
        </div>
        <HistoriaCobro recibo={recibo} familiaId={familia.id} locale={locale} conNota />
        <Link
          href={`/${locale}/admin/cuotas?tab=mes&anio=${recibo.anio}&mes=${recibo.mes}&familia=${familia.id}`}
          className="text-muted-foreground hover:text-foreground inline-block text-sm font-medium underline"
        >
          {t('ver_en_cuotas')}
        </Link>
      </header>

      <section className="space-y-3">
        <h2 className="text-h3 text-foreground">{t('desglose')}</h2>
        {sinLineas ? (
          <Card>
            <CardContent className="text-muted-foreground pt-1 text-sm">
              {t('sin_lineas')}
            </CardContent>
          </Card>
        ) : (
          <DesgloseRecibo
            desglose={desglose}
            totalCentimos={recibo.totalCentimos}
            locale={locale}
          />
        )}
      </section>
    </div>
  )
}
