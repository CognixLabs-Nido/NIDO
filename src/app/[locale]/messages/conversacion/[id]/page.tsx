import { notFound, redirect } from 'next/navigation'

import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { ConversacionView } from '@/features/messaging/components/ConversacionView'
import { getConversacionDetalle } from '@/features/messaging/queries/get-conversacion-detalle'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

export default async function ConversacionPage({ params }: PageProps) {
  const { locale, id } = await params

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rolRaw = await getRolEnCentro(centroId)
  if (
    !rolRaw ||
    (rolRaw !== 'admin' &&
      rolRaw !== 'profe' &&
      rolRaw !== 'tutor_legal' &&
      rolRaw !== 'autorizado')
  ) {
    redirect(`/${locale}/forbidden`)
  }
  const rol = rolRaw as 'admin' | 'profe' | 'tutor_legal' | 'autorizado'

  const detalle = await getConversacionDetalle(id)
  if (!detalle) notFound()

  return (
    <ConversacionView
      locale={locale}
      rol={rol}
      header={detalle.header}
      mensajes={detalle.mensajes}
      participo={detalle.participo}
    />
  )
}
