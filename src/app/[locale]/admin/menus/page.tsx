import { CalendarRangeIcon, UtensilsIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { NuevaPlantillaDialog } from '@/features/menus/components/NuevaPlantillaDialog'
import { getPlantillasCentro } from '@/features/menus/queries/get-plantillas-centro'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { EmptyState } from '@/shared/components/EmptyState'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function AdminMenusPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('menus')
  const tEstado = await getTranslations('menus.estado')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'admin') redirect(`/${locale}/forbidden`)

  const plantillas = await getPlantillasCentro(centroId)

  const intlTag = locale === 'va' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES'
  const fmtMes = (mes: number, anio: number) =>
    new Intl.DateTimeFormat(intlTag, { month: 'long', year: 'numeric' }).format(
      new Date(anio, mes - 1, 1)
    )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-h1 text-foreground flex items-center gap-2">
            <UtensilsIcon className="text-primary-600 size-7" />
            {t('title')}
          </h1>
          <p className="text-muted-foreground text-sm">{t('lista.title')}</p>
        </div>
        <NuevaPlantillaDialog centroId={centroId} locale={locale as 'es' | 'en' | 'va'} />
      </header>

      {plantillas.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState icon={<CalendarRangeIcon strokeWidth={1.75} />} title={t('lista.vacio')} />
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2" aria-label={t('lista.title')}>
          {plantillas.map((p) => (
            <li key={p.id}>
              <Link
                href={`/${locale}/admin/menus/${p.id}`}
                data-testid={`plantilla-${p.id}`}
                className="focus-visible:ring-ring block rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <Card className="hover:border-primary-200 transition hover:shadow-md">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-foreground text-lg font-semibold capitalize">
                        {fmtMes(p.mes, p.anio)}
                      </h2>
                      <p className="text-muted-foreground text-xs">
                        {new Intl.DateTimeFormat(intlTag, { dateStyle: 'medium' }).format(
                          new Date(p.created_at)
                        )}
                      </p>
                    </div>
                    <Badge
                      variant={
                        p.estado === 'borrador'
                          ? 'warm'
                          : p.estado === 'publicada'
                            ? 'success'
                            : 'secondary'
                      }
                      data-testid={`estado-${p.estado}`}
                    >
                      {tEstado(p.estado)}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
