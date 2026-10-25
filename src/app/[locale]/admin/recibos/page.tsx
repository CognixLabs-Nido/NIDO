import { ChevronLeftIcon, ChevronRightIcon, ReceiptIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { FiltrosHistorialRecibos } from '@/features/recibos/components/FiltrosHistorialRecibos'
import { HistorialRecibosGeneral } from '@/features/recibos/components/HistorialRecibosGeneral'
import {
  hrefHistorial,
  leerFiltroHistorial,
  type ParamsHistorial,
} from '@/features/recibos/lib/filtro-historial'
import {
  getHistorialRecibosGeneral,
  RECIBOS_POR_PAGINA,
} from '@/features/recibos/queries/get-historial-recibos-general'
import { getOpcionesHistorial } from '@/features/recibos/queries/get-opciones-historial'
import { EmptyState } from '@/shared/components/EmptyState'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<ParamsHistorial>
}

/**
 * F-6 — histórico general de recibos del centro, para Dirección: todos los recibos, del más reciente
 * al más antiguo, con su estado y lo que pasó al cobrarlos, filtrados por año, mes, familia y niño y
 * paginados en la BD. Cada recibo se abre en su detalle. El layout admin valida rol y centro.
 */
export default async function HistorialRecibosPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('admin.recibos')
  const { centroId } = await requireContextoCentro(locale)
  const filtro = leerFiltroHistorial(await searchParams)

  const [historial, opciones] = await Promise.all([
    getHistorialRecibosGeneral(centroId, filtro),
    getOpcionesHistorial(centroId),
  ])

  const base = `/${locale}/admin/recibos`
  // Los años del selector: desde el primero con recibos que admite la app hasta el siguiente al actual.
  const anioActual = new Date().getFullYear()
  const anios = Array.from({ length: anioActual + 2 - 2024 }, (_, i) => anioActual + 1 - i)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 flex items-center gap-2">
          <ReceiptIcon className="text-muted-foreground size-6" />
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>

      <FiltrosHistorialRecibos
        filtro={filtro}
        anios={anios}
        familias={opciones.ok ? opciones.familias : []}
        ninos={opciones.ok ? opciones.ninos : []}
      />
      {/* Sin las listas, los filtros por familia y niño quedan vacíos: se dice, no se calla. */}
      {!opciones.ok && <p className="text-warm-800 text-sm">{t('error_opciones')}</p>}

      {!historial.ok ? (
        <Card>
          <CardContent className="text-warm-800 pt-1 text-sm">{t('error')}</CardContent>
        </Card>
      ) : historial.total === 0 ? (
        <Card>
          <EmptyState icon={<ReceiptIcon strokeWidth={1.75} />} title={t('vacio')} />
        </Card>
      ) : (
        <>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {t('mostrando', {
              desde: (historial.pagina - 1) * RECIBOS_POR_PAGINA + 1,
              hasta: (historial.pagina - 1) * RECIBOS_POR_PAGINA + historial.recibos.length,
              total: historial.total,
            })}
          </p>
          <HistorialRecibosGeneral recibos={historial.recibos} locale={locale} />
          {historial.paginas > 1 && (
            <nav
              aria-label={t('paginacion')}
              className="flex items-center justify-between gap-3 text-sm"
            >
              {historial.pagina > 1 ? (
                <Link
                  href={hrefHistorial(base, { ...filtro, pagina: historial.pagina - 1 })}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-medium"
                >
                  <ChevronLeftIcon className="size-4" />
                  {t('anterior')}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                {t('pagina_de', { pagina: historial.pagina, paginas: historial.paginas })}
              </span>
              {historial.pagina < historial.paginas ? (
                <Link
                  href={hrefHistorial(base, { ...filtro, pagina: historial.pagina + 1 })}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-medium"
                >
                  {t('siguiente')}
                  <ChevronRightIcon className="size-4" />
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  )
}
