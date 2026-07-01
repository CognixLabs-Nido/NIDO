import { ArrowLeftIcon, CoinsIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ESTADO_BADGE_VARIANT, formatPeriodo } from '@/features/recibos/lib/formato'
import { getReciboFamiliaDetalle } from '@/features/recibos/queries/get-recibo-familia-detalle'
import { formatEuros } from '@/shared/lib/format-money'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

/**
 * Detalle de un recibo — vista de familia (F12-B-7). Muestra el desglose de líneas
 * (conceptos, becas negativas, saldo arrastrado) con su importe y el total. Solo lectura.
 * La RLS restringe a los hijos del tutor legal; si no es visible → notFound.
 */
export default async function FamilyReciboDetallePage({ params }: PageProps) {
  const { locale, id } = await params
  const t = await getTranslations('recibos')
  const recibo = await getReciboFamiliaDetalle(id)
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
          <span className="text-muted-foreground">{recibo.ninoNombre}</span>
          <Badge variant={ESTADO_BADGE_VARIANT[recibo.estado]}>
            {t(`estado_recibo.${recibo.estado}`)}
          </Badge>
          {recibo.esRegiro && <Badge variant="outline">{t('regiro_badge')}</Badge>}
        </div>
        <p className="text-muted-foreground text-sm">
          {t('metodo_label')}: {recibo.metodo ? t(`metodos.${recibo.metodo}`) : t('sin_metodo')}
          {recibo.fechaEnvioBanco && <> · {t('enviado_el', { fecha: recibo.fechaEnvioBanco })}</>}
          {recibo.fechaDevolucion && <> · {t('devuelto_el', { fecha: recibo.fechaDevolucion })}</>}
        </p>
      </header>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('desglose_title')}</caption>
            <thead className="text-muted-foreground border-b text-left text-xs">
              <tr>
                <th scope="col" className="p-3 font-medium">
                  {t('concepto')}
                </th>
                <th scope="col" className="p-3 text-right font-medium">
                  {t('cantidad')}
                </th>
                <th scope="col" className="p-3 text-right font-medium">
                  {t('precio_unitario')}
                </th>
                <th scope="col" className="p-3 text-right font-medium">
                  {t('importe')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recibo.lineas.map((l) => (
                <tr key={l.id}>
                  <td className="p-3">{l.descripcion}</td>
                  <td className="p-3 text-right tabular-nums">{l.cantidad}</td>
                  <td className="p-3 text-right tabular-nums">
                    {formatEuros(l.precioUnitarioCentimos)}
                  </td>
                  <td className="p-3 text-right tabular-nums">{formatEuros(l.importeCentimos)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t font-semibold">
              <tr>
                <td className="p-3" colSpan={3}>
                  {t('total')}
                </td>
                <td className="p-3 text-right tabular-nums">{formatEuros(recibo.totalCentimos)}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
