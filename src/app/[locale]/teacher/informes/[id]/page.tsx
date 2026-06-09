import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { InformeEditor } from '@/features/informes/components/InformeEditor'
import { getInformeEvolucionDetalle } from '@/features/informes/queries/get-informes-profe'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

/**
 * Detalle de un informe: rellenar (borrador) o leer (publicado / tecnico-apoyo).
 * El acceso lo gobierna la RLS de `informes_evolucion`; si no hay fila visible,
 * volvemos a la lista.
 */
export default async function TeacherInformeDetallePage({ params }: PageProps) {
  const { locale, id } = await params
  const t = await getTranslations('informes')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'profe' && rol !== 'admin') redirect(`/${locale}/forbidden`)

  const informe = await getInformeEvolucionDetalle(id)
  if (!informe) redirect(`/${locale}/teacher/informes`)

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/teacher/informes`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeftIcon className="size-4" />
        {t('volver')}
      </Link>

      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{informe.nino_nombre}</h1>
        <p className="text-muted-foreground text-sm">{t(`periodos.${informe.periodo}`)}</p>
      </header>

      <InformeEditor informe={informe} />
    </div>
  )
}
