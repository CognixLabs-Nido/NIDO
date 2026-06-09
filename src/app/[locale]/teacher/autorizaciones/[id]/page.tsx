import { redirect } from 'next/navigation'

import { AutorizacionDetalleView } from '@/features/autorizaciones/components/AutorizacionDetalleView'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

export default async function TeacherAutorizacionDetallePage({ params }: PageProps) {
  const { locale, id } = await params

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'profe' && rol !== 'admin') redirect(`/${locale}/forbidden`)

  return <AutorizacionDetalleView id={id} volverHref={`/${locale}/teacher/autorizaciones`} />
}
