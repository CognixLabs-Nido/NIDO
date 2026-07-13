import { getTranslations } from 'next-intl/server'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { FamiliasListado } from '@/features/familias/components/FamiliasListado'
import { getFamiliasParaGestion } from '@/features/familias/queries/get-familias-gestion'

interface PageProps {
  params: Promise<{ locale: string }>
}

/** F-6a — listado de gestión de familias del centro (Dirección). */
export default async function AdminFamiliasPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('admin.familias')
  const centroId = (await getCentroActualId())!
  const familias = await getFamiliasParaGestion(centroId)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>
      <FamiliasListado familias={familias} locale={locale} />
    </div>
  )
}
