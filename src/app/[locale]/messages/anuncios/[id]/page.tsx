import { notFound } from 'next/navigation'

import { AnuncioView } from '@/features/messaging/components/AnuncioView'
import { getAnuncioDetalle } from '@/features/messaging/queries/get-anuncio-detalle'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

export default async function AnuncioPage({ params }: PageProps) {
  const { locale, id } = await params

  const anuncio = await getAnuncioDetalle(id)
  if (!anuncio) notFound()

  return <AnuncioView locale={locale} anuncio={anuncio} />
}
