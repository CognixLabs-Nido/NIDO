import { ArrowLeftIcon, CoinsIcon, DownloadIcon, UsersIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ESTADO_BADGE_VARIANT, formatPeriodo } from '@/features/recibos/lib/formato'
import type { LineaReciboFamilia } from '@/features/recibos/lib/recibo-familia-detalle'
import { getReciboFamiliaDetalle } from '@/features/recibos/queries/get-recibo-familia-detalle'
import { formatEuros } from '@/shared/lib/format-money'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

/**
 * Detalle de un recibo FAMILIAR — vista de familia (F-4-6). Cabecera con período, estado,
 * método y total; el desglose de líneas se agrupa POR HIJO (lo que se cobra a cada uno) y,
 * aparte, un bloque de líneas FAMILIARES (descuento hermanos, saldo arrastrado, cargo de
 * familia). Solo lectura. La RLS restringe a la familia del tutor; borradores y recibos no
 * visibles → notFound.
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

  const { gruposHijo, lineasFamiliares, subtotalFamiliarCentimos } = recibo.desglose

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

      <Card>
        <CardContent className="space-y-6 p-0">
          {gruposHijo.map((g) => (
            <SeccionLineas
              key={g.ninoId}
              titulo={g.ninoNombre}
              lineas={g.lineas}
              subtotalCentimos={g.subtotalCentimos}
              subtotalLabel={t('subtotal')}
              cabeceras={{
                concepto: t('concepto'),
                cantidad: t('cantidad'),
                precioUnitario: t('precio_unitario'),
                importe: t('importe'),
              }}
            />
          ))}
          {lineasFamiliares.length > 0 && (
            <SeccionLineas
              titulo={t('lineas_familiares')}
              icono={<UsersIcon className="size-4" />}
              lineas={lineasFamiliares}
              subtotalCentimos={subtotalFamiliarCentimos}
              subtotalLabel={t('subtotal')}
              cabeceras={{
                concepto: t('concepto'),
                cantidad: t('cantidad'),
                precioUnitario: t('precio_unitario'),
                importe: t('importe'),
              }}
            />
          )}
          <div className="flex items-center justify-between border-t px-3 py-3 text-sm font-semibold">
            <span>{t('total')}</span>
            <span className="tabular-nums">{formatEuros(recibo.totalCentimos)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** Una sección del desglose (un hijo o el bloque familiar) con su tabla de líneas y subtotal. */
function SeccionLineas({
  titulo,
  icono,
  lineas,
  subtotalCentimos,
  subtotalLabel,
  cabeceras,
}: {
  titulo: string
  icono?: React.ReactNode
  lineas: LineaReciboFamilia[]
  subtotalCentimos: number
  subtotalLabel: string
  cabeceras: { concepto: string; cantidad: string; precioUnitario: string; importe: string }
}) {
  return (
    <section>
      <h2 className="text-foreground flex items-center gap-2 px-3 pt-3 text-sm font-semibold">
        {icono}
        {titulo}
      </h2>
      <table className="w-full text-sm">
        <caption className="sr-only">{titulo}</caption>
        <thead className="text-muted-foreground border-b text-left text-xs">
          <tr>
            <th scope="col" className="p-3 font-medium">
              {cabeceras.concepto}
            </th>
            <th scope="col" className="p-3 text-right font-medium">
              {cabeceras.cantidad}
            </th>
            <th scope="col" className="p-3 text-right font-medium">
              {cabeceras.precioUnitario}
            </th>
            <th scope="col" className="p-3 text-right font-medium">
              {cabeceras.importe}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {lineas.map((l) => (
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
        <tfoot className="border-t text-xs font-medium">
          <tr>
            <td className="text-muted-foreground p-3" colSpan={3}>
              {subtotalLabel}
            </td>
            <td className="p-3 text-right tabular-nums">{formatEuros(subtotalCentimos)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  )
}
