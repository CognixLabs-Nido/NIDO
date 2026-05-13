import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getAulasPorCurso } from '@/features/aulas/queries/get-aulas'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getCursoActivo } from '@/features/cursos/queries/get-cursos'
import { NuevoNinoWizard } from '@/features/ninos/components/NuevoNinoWizard'

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
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('nuevo_sin_aulas')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">{t('wizard.title')}</h1>
      <NuevoNinoWizard centroId={centroId} locale={locale} aulas={aulas} />
    </div>
  )
}
