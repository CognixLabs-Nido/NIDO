import { ArrowLeftIcon, CoinsIcon, DownloadIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { ambitoFamiliar } from '@/features/centros/contexto/ambito-familiar'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { DesgloseRecibo } from '@/features/recibos/components/DesgloseRecibo'
import { ESTADO_BADGE_VARIANT, formatPeriodo } from '@/features/recibos/lib/formato'
import { getReciboFamiliaDetalle } from '@/features/recibos/queries/get-recibo-familia-detalle'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

/**
 * Detalle de un recibo FAMILIAR — vista de familia (F-4-6). Cabecera con período, estado,
 * método y total; el desglose de líneas se agrupa POR HIJO (lo que se cobra a cada uno) y,
 * aparte, un bloque de líneas FAMILIARES (descuento hermanos, saldo arrastrado, cargo de
 * familia). Solo lectura. La RLS restringe a la familia del tutor; borradores, recibos no
 * visibles y los de otro centro que el activo → notFound.
 */
export default async function FamilyReciboDetallePage({ params }: PageProps) {
  const { locale, id } = await params
  const t = await getTranslations('recibos')
  const { centroId } = await requireContextoCentro(locale)
  const recibo = await getReciboFamiliaDetalle(await ambitoFamiliar(centroId), id)
  if (!recibo) notFound()

  const titulo =
    recibo.esEsporadico && recibo.conceptoEsporadico
      ? recibo.conceptoEsporadico
      : formatPeriodo(recibo.anio, recibo.mes, locale)

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/family/recibos`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeftIcon className="size-4" />
        {t('back')}
      </Link>

      <header className="space-y-2">
        <h1 className="text-h1 text-foreground flex items-center gap-2">
          <CoinsIcon className="text-primary-600 size-7" />
          {titulo}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={ESTADO_BADGE_VARIANT[recibo.estado]}>
            {t(`estado_recibo.${recibo.estado}`)}
          </Badge>
          {recibo.esEsporadico && <Badge variant="outline">{t('esporadico_badge')}</Badge>}
          {recibo.esRegiro && <Badge variant="outline">{t('regiro_badge')}</Badge>}
        </div>
        <p className="text-muted-foreground text-sm">
          {t('metodo_label')}: {recibo.metodo ? t(`metodos.${recibo.metodo}`) : t('sin_metodo')}
          {recibo.fechaEnvioBanco && <> · {t('enviado_el', { fecha: recibo.fechaEnvioBanco })}</>}
          {recibo.fechaDevolucion && <> · {t('devuelto_el', { fecha: recibo.fechaDevolucion })}</>}
        </p>
        <a
          href={`/${locale}/family/recibos/${id}/pdf`}
          className="bg-primary-600 hover:bg-primary-700 focus-visible:ring-ring inline-flex w-fit items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white transition focus-visible:ring-2 focus-visible:outline-none"
        >
          <DownloadIcon className="size-4" />
          {t('descargar_pdf')}
        </a>
      </header>

      <DesgloseRecibo
        desglose={recibo.desglose}
        totalCentimos={recibo.totalCentimos}
        locale={locale}
      />
    </div>
  )
}
