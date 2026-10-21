import { redirect } from 'next/navigation'

import { AutorizacionDetalleView } from '@/features/autorizaciones/components/AutorizacionDetalleView'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

export default async function TeacherAutorizacionDetallePage({ params }: PageProps) {
  const { locale, id } = await params

  const { rol, esResponsable } = await requireContextoCentro(locale)
  if (rol !== 'profe' && rol !== 'admin') redirect(`/${locale}/forbidden`)

  return (
    <AutorizacionDetalleView
      id={id}
      volverHref={`/${locale}/teacher/autorizaciones`}
      esResponsable={esResponsable}
    />
  )
}
