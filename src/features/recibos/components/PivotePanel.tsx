import { DownloadIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { MesSelector } from '@/features/cuotas-config/components/MesSelector'
import { ESTADO_BADGE_VARIANT } from '@/features/recibos/lib/formato'
import type { PivoteRecibos } from '@/features/recibos/lib/pivote'
import { formatEuros } from '@/shared/lib/format-money'

interface Props {
  locale: string
  anio: number
  mes: number
  pivote: PivoteRecibos
}

/**
 * Resumen de recibos del período en tabla pivote (F12-B-7, dirección). Filas = recibo
 * (tutor + niño + estado + método), columnas = por concepto, con total por fila, totales
 * por columna y total general. Selector de período + descarga CSV (bajo demanda, ruta
 * dedicada). Solo lectura.
 */
export async function PivotePanel({ locale, anio, mes, pivote }: Props) {
  const t = await getTranslations('recibos')
  const csvHref = `/${locale}/admin/cuotas/recibos/csv?anio=${anio}&mes=${mes}`

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-foreground text-base font-semibold">{t('pivote_title')}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <MesSelector anio={anio} mes={mes} tab="resumen" />
          {pivote.filas.length > 0 && (
            <a
              href={csvHref}
              download
              className="border-input bg-background hover:bg-muted focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition focus-visible:ring-2 focus-visible:outline-none"
            >
              <DownloadIcon className="size-4" />
              {t('exportar_csv')}
            </a>
          )}
        </div>
      </div>

      {pivote.filas.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t('pivote_vacia', { periodo: `${mes}/${anio}` })}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">{t('pivote_title')}</caption>
            <thead className="text-muted-foreground border-b text-left text-xs">
              <tr>
                <th scope="col" className="p-2 font-medium">
                  {t('csv.tutor')}
                </th>
                <th scope="col" className="p-2 font-medium">
                  {t('csv.nino')}
                </th>
                <th scope="col" className="p-2 font-medium">
                  {t('csv.estado')}
                </th>
                {pivote.columnas.map((c) => (
                  <th key={c.key} scope="col" className="p-2 text-right font-medium">
                    {c.label}
                  </th>
                ))}
                <th scope="col" className="p-2 text-right font-medium">
                  {t('csv.total')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pivote.filas.map((f) => (
                <tr key={f.reciboId}>
                  <td className="p-2">{f.tutorNombre}</td>
                  <td className="p-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {f.ninoNombre}
                      {f.esEsporadico && <Badge variant="outline">{t('esporadico_badge')}</Badge>}
                      {f.esRegiro && <Badge variant="outline">{t('regiro_badge')}</Badge>}
                    </span>
                  </td>
                  <td className="p-2">
                    <Badge variant={ESTADO_BADGE_VARIANT[f.estado]}>
                      {t(`estado_recibo.${f.estado}`)}
                    </Badge>
                  </td>
                  {pivote.columnas.map((c) => (
                    <td key={c.key} className="p-2 text-right tabular-nums">
                      {f.celdas[c.key] !== undefined ? (
                        formatEuros(f.celdas[c.key], locale)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  ))}
                  <td className="p-2 text-right font-medium tabular-nums">
                    {formatEuros(f.totalCentimos, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t font-semibold">
              <tr>
                <td className="p-2" colSpan={3}>
                  {t('csv.totales')}
                </td>
                {pivote.columnas.map((c) => (
                  <td key={c.key} className="p-2 text-right tabular-nums">
                    {formatEuros(pivote.totalesColumna[c.key] ?? 0, locale)}
                  </td>
                ))}
                <td className="p-2 text-right tabular-nums">
                  {formatEuros(pivote.totalGeneral, locale)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  )
}
