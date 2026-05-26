import { notFound } from 'next/navigation'

import { AnuncioView } from '@/features/messaging/components/AnuncioView'
import { getAnuncioDetalle } from '@/features/messaging/queries/get-anuncio-detalle'
import { getLectoresAnuncio } from '@/features/messaging/queries/get-lectores-anuncio'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

export default async function AnuncioPage({ params }: PageProps) {
  const { locale, id } = await params

  const anuncio = await getAnuncioDetalle(id)
  if (!anuncio) notFound()

  // Solo el autor ve la lista de lectores. El detalle ya viene con
  // `lectores: { total, leidos }` para el contador; el array completo
  // (`lectores_detalle`) alimenta el modal. RLS lo enforza también:
  // un destinatario que invocara la query directamente solo vería su
  // propia fila por la policy `lectura_anuncio_select_self`.
  const lectoresDetalle = anuncio.es_propio ? await getLectoresAnuncio(id) : []

  return <AnuncioView locale={locale} anuncio={anuncio} lectoresDetalle={lectoresDetalle} />
}
