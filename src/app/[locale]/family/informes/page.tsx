import { ClipboardListIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { fondoInforme } from '@/features/informes/lib/estilos'
import { getInformesPublicadosFamilia } from '@/features/informes/queries/get-informes-familia'
import { EmptyState } from '@/shared/components/EmptyState'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * Informes de evolución — vista de familia (F9-3). Lista los informes PUBLICADOS
 * de cada hijo, agrupados por curso académico (histórico completo) y período. Solo
 * lectura: cada período enlaza al detalle. Sin descarga PDF (eso es F9-4). La RLS
 * garantiza que nunca aparecen borradores ni informes de otros niños.
 */
export default async function FamilyInformesPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('informes')
  const ninos = await getInformesPublicadosFamilia()

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-h1 text-foreground flex items-center gap-2">
          <ClipboardListIcon className="text-primary-600 size-7" />
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('family_intro')}</p>
      </header>

      {ninos.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<ClipboardListIcon strokeWidth={1.75} />}
              title={t('family_sin_informes')}
              description={t('family_sin_informes_desc')}
            />
          </CardContent>
        </Card>
      ) : (
        ninos.map((nino) => (
          <section key={nino.ninoId} className="space-y-4">
            <h2 className="text-h2 text-foreground">
              {nino.nombre} {nino.apellidos}
            </h2>
            {nino.cursos.map((curso) => (
              <div key={curso.cursoId} className="space-y-2">
                {curso.cursoNombre && (
                  <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {curso.cursoNombre}
                  </h3>
                )}
                <div className="flex flex-wrap gap-2">
                  {curso.items.map((item) => (
                    <Link
                      key={item.id}
                      href={`/${locale}/family/informes/${item.id}`}
                      className={cn(
                        'focus-visible:ring-ring flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition focus-visible:ring-2 focus-visible:outline-none',
                        fondoInforme(item.estado)
                      )}
                    >
                      <ClipboardListIcon className="size-4 shrink-0" />
                      <span>{t(`periodos.${item.periodo}`)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  )
}
