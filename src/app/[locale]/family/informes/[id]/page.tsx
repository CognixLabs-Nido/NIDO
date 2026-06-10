import { ChevronLeftIcon, DownloadIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Button } from '@/components/ui/button'

import { InformeView } from '@/features/informes/components/InformeView'
import { getInformeEvolucionDetalle } from '@/features/informes/queries/get-informes-profe'
import { MarcarInformeVistoOnMount } from '@/features/notificaciones/components/MarcarInformeVistoOnMount'

interface PageProps {
  params: Promise<{ id: string; locale: string }>
}

/**
 * Detalle de un informe publicado — vista de familia (F9-3). Solo lectura. La RLS
 * de `informes_evolucion` garantiza que la familia solo accede a publicados de sus
 * hijos: si el id no es legible (borrador, otro niño, otro centro), la query
 * devuelve null → 404. Al montar se marca como visto (baja el aviso de inicio).
 */
export default async function FamilyInformeDetallePage({ params }: PageProps) {
  const { id, locale } = await params
  const t = await getTranslations('informes')

  const informe = await getInformeEvolucionDetalle(id)
  // Defensa en profundidad: la familia nunca debe abrir un borrador (la RLS ya lo
  // impide; este guard cubre el caso de un staff que llegara por esta ruta).
  if (!informe || informe.estado !== 'publicado') notFound()

  return (
    <div className="space-y-6">
      <MarcarInformeVistoOnMount informeId={informe.id} />

      <Link
        href={`/${locale}/family/informes`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeftIcon className="size-4" />
        {t('title')}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-h2 text-foreground">{informe.nino_nombre}</h1>
          <p className="text-muted-foreground text-sm">
            {t(`periodos.${informe.periodo}`)}
            {informe.publicado_at && (
              <>
                {' · '}
                {t('family_publicado_el', { fecha: informe.publicado_at.slice(0, 10) })}
              </>
            )}
          </p>
        </div>
        {/* Descarga server-side (Q11). Anchor (no Link): es una descarga, no navegación. */}
        <Button
          variant="outline"
          render={<a href={`/${locale}/informes/${informe.id}/pdf`} />}
          data-testid="descargar-pdf-button"
        >
          <DownloadIcon className="size-4" />
          <span className="ml-1">{t('descargar_pdf')}</span>
        </Button>
      </header>

      <InformeView informe={informe} />
    </div>
  )
}
