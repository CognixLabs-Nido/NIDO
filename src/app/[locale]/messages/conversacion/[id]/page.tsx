import { notFound } from 'next/navigation'

import { ConversacionView } from '@/features/messaging/components/ConversacionView'
import { getConversacionDetalle } from '@/features/messaging/queries/get-conversacion-detalle'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

export default async function ConversacionPage({ params }: PageProps) {
  const { locale, id } = await params

  const detalle = await getConversacionDetalle(id)
  if (!detalle) notFound()

  return (
    <ConversacionView
      locale={locale}
      header={detalle.header}
      mensajes={detalle.mensajes}
      participo={detalle.participo}
    />
  )
}
