import { UsersIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Card, CardContent } from '@/components/ui/card'
import { formatEuros } from '@/shared/lib/format-money'

import type { DesgloseReciboFamilia, LineaReciboFamilia } from '../lib/recibo-familia-detalle'

/**
 * Desglose de un recibo familiar: un bloque por hijo con sus líneas y subtotal, el bloque de líneas
 * de la familia (descuento hermanos, saldo, devolución arrastrada, sobrante de un cheque) y el
 * total. Lo usan la vista de la familia (F-4-6) y la de Dirección (F-6).
 */
export function DesgloseRecibo({
  desglose,
  totalCentimos,
  locale,
}: {
  desglose: DesgloseReciboFamilia
  totalCentimos: number
  locale: string
}) {
  const t = useTranslations('recibos')
  const { gruposHijo, lineasFamiliares, subtotalFamiliarCentimos } = desglose
  return (
    <Card>
      <CardContent className="space-y-6 p-0">
        {gruposHijo.map((g) => (
          <SeccionLineas
            locale={locale}
            key={g.ninoId}
            titulo={g.ninoNombre}
            lineas={g.lineas}
            subtotalCentimos={g.subtotalCentimos}
          />
        ))}
        {lineasFamiliares.length > 0 && (
          <SeccionLineas
            locale={locale}
            titulo={t('lineas_familiares')}
            icono={<UsersIcon className="size-4" />}
            lineas={lineasFamiliares}
            subtotalCentimos={subtotalFamiliarCentimos}
          />
        )}
        <div className="flex items-center justify-between border-t px-3 py-3 text-sm font-semibold">
          <span>{t('total')}</span>
          <span className="tabular-nums">{formatEuros(totalCentimos, locale)}</span>
        </div>
      </CardContent>
    </Card>
  )
}

/** Una sección del desglose (un hijo o el bloque familiar) con su tabla de líneas y subtotal. */
function SeccionLineas({
  titulo,
  icono,
  lineas,
  subtotalCentimos,
  locale,
}: {
  titulo: string
  icono?: React.ReactNode
  lineas: LineaReciboFamilia[]
  subtotalCentimos: number
  locale: string
}) {
  const t = useTranslations('recibos')
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
          {lineas.map((l) => (
            <tr key={l.id}>
              <td className="p-3">{l.descripcion}</td>
              <td className="p-3 text-right tabular-nums">{l.cantidad}</td>
              <td className="p-3 text-right tabular-nums">
                {formatEuros(l.precioUnitarioCentimos, locale)}
              </td>
              <td className="p-3 text-right tabular-nums">
                {formatEuros(l.importeCentimos, locale)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t text-xs font-medium">
          <tr>
            <td className="text-muted-foreground p-3" colSpan={3}>
              {t('subtotal')}
            </td>
            <td className="p-3 text-right tabular-nums">{formatEuros(subtotalCentimos, locale)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  )
}
