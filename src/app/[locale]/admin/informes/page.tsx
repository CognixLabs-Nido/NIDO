import { ArrowLeftIcon, CalendarRangeIcon, ClipboardListIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { ArchivarPlantillaButton } from '@/features/informes/components/ArchivarPlantillaButton'
import { PlantillaInformeDialog } from '@/features/informes/components/PlantillaInformeDialog'
import { contarItems } from '@/features/informes/lib/estructura'
import { getPlantillasInforme } from '@/features/informes/queries/get-plantillas-informe'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ historico?: string }>
}

const BASE = '/admin/informes'

export default async function AdminInformesPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const soloHistorico = (await searchParams).historico === '1'
  const t = await getTranslations('informes')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'admin') redirect(`/${locale}/forbidden`)

  // --- Vista de archivadas (solo lectura) -----------------------------------
  if (soloHistorico) {
    const archivadas = await getPlantillasInforme(true)
    return (
      <div className="space-y-6">
        <Link
          href={`/${locale}${BASE}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-4" />
          {t('volver')}
        </Link>
        <header className="space-y-1">
          <h1 className="text-h1 text-foreground">{t('plantillas.archivadas_titulo')}</h1>
        </header>
        {archivadas.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('plantillas.archivadas_vacio')}</p>
        ) : (
          <ul className="divide-border divide-y rounded-lg border">
            {archivadas.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex flex-col">
                  <span className="font-medium">{p.titulo}</span>
                  <span className="text-muted-foreground text-xs">
                    {t('plantillas.areas_resumen', {
                      areas: p.estructura.length,
                      items: contarItems(p.estructura),
                    })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // --- Vista principal: plantillas activas ----------------------------------
  const activas = await getPlantillasInforme(false)

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-2">
          <h1 className="text-h1 text-foreground flex items-center gap-2">
            <ClipboardListIcon className="text-primary-600 size-7" />
            {t('title')}
          </h1>
          <p className="text-muted-foreground text-sm">{t('admin_intro')}</p>
          <Link
            href={`/${locale}${BASE}/campanas`}
            className="text-primary-700 hover:text-primary-800 inline-flex items-center gap-1 text-sm font-medium"
          >
            <CalendarRangeIcon className="size-4" />
            {t('campana.ir_a_campanas')}
          </Link>
        </div>
        <PlantillaInformeDialog />
      </header>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <h2 className="text-h2 text-foreground">{t('plantillas.titulo')}</h2>
            <p className="text-muted-foreground text-sm">{t('plantillas.descripcion')}</p>
          </div>
          <Link
            href={`/${locale}${BASE}?historico=1`}
            className="text-muted-foreground hover:text-foreground text-sm underline"
          >
            {t('plantillas.ver_archivadas')}
          </Link>
        </div>

        {activas.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('plantillas.activas_vacio')}</p>
        ) : (
          <ul className="divide-border divide-y rounded-lg border">
            {activas.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex flex-col">
                  <span className="font-medium">{p.titulo}</span>
                  <span className="text-muted-foreground text-xs">
                    {t('plantillas.areas_resumen', {
                      areas: p.estructura.length,
                      items: contarItems(p.estructura),
                    })}
                  </span>
                </span>
                <span className="flex gap-2">
                  <PlantillaInformeDialog plantilla={p} />
                  <ArchivarPlantillaButton plantillaId={p.id} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
