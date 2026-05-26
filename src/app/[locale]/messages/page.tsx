import { MegaphoneIcon, PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Button } from '@/components/ui/button'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { MessagesListView } from '@/features/messaging/components/MessagesListView'
import { getAnunciosDelUsuario } from '@/features/messaging/queries/get-anuncios'
import { getConversacionesDelUsuario } from '@/features/messaging/queries/get-conversaciones'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function MessagesPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('messages.anuncio')

  const centroId = await getCentroActualId()
  const rol = centroId ? await getRolEnCentro(centroId) : null
  const puedePublicarAnuncio = rol === 'admin' || rol === 'profe'

  const [conversaciones, anuncios] = await Promise.all([
    getConversacionesDelUsuario(),
    getAnunciosDelUsuario(),
  ])

  return (
    <div className="space-y-4">
      {puedePublicarAnuncio && (
        <div className="flex justify-end">
          <Button render={<Link href={`/${locale}/messages/nuevo-anuncio`} />}>
            <MegaphoneIcon className="size-4" />
            <PlusIcon className="size-3" />
            <span className="ml-1">{t('nuevo')}</span>
          </Button>
        </div>
      )}
      <MessagesListView locale={locale} conversaciones={conversaciones} anuncios={anuncios} />
    </div>
  )
}
