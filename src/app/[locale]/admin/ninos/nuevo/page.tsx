import { ChevronLeftIcon, BookOpenIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Card } from '@/components/ui/card'
import { getAulasPorCurso } from '@/features/aulas/queries/get-aulas'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getCursoActivo } from '@/features/cursos/queries/get-cursos'
import { NuevoNinoWizard } from '@/features/ninos/components/NuevoNinoWizard'
import { EmptyState } from '@/shared/components/EmptyState'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function NuevoNinoPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('admin.ninos')
  const centroId = (await getCentroActualId())!
  const curso = await getCursoActivo(centroId)
  if (!curso) {
    redirect(`/${locale}/admin/cursos`)
  }

  const aulas = await getAulasPorCurso(curso.id)

  if (aulas.length === 0) {
    return (
      <div className="space-y-6">
        <BackLink locale={locale} label={t('title')} />
        <Card>
          <EmptyState
            icon={<BookOpenIcon strokeWidth={1.75} />}
            title={t('nuevo_sin_aulas')}
            cta={{ label: t('title'), href: `/${locale}/admin/aulas` }}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <BackLink locale={locale} label={t('title')} />
      <NuevoNinoWizard centroId={centroId} locale={locale} aulas={aulas} />
    </div>
  )
}

function BackLink({ locale, label }: { locale: string; label: string }) {
  return (
    <Link
      href={`/${locale}/admin/ninos`}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
    >
      <ChevronLeftIcon className="size-4" />
      {label}
    </Link>
  )
}
