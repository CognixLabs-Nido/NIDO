import { notFound } from 'next/navigation'

import { ConfirmarCentroDelAviso } from '@/features/centros/components/ConfirmarCentroDelAviso'
import { centroDelAvisoPorConfirmar } from '@/features/centros/contexto/centro-del-aviso'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { AnuncioView } from '@/features/messaging/components/AnuncioView'
import { getAnuncioDetalle } from '@/features/messaging/queries/get-anuncio-detalle'
import { getLectoresAnuncio } from '@/features/messaging/queries/get-lectores-anuncio'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
  searchParams: Promise<{ centro?: string }>
}

export default async function AnuncioPage({ params, searchParams }: PageProps) {
  const { locale, id } = await params
  const { centro } = await searchParams

  // Multicentro: el anuncio de otro centro del usuario da «no encontrado»; si llega de una
  // notificación de ese centro, antes se ofrece cambiar.
  const contexto = await requireContextoCentro(locale)
  const centroDelAviso = centroDelAvisoPorConfirmar(contexto, centro)
  if (centroDelAviso) {
    return (
      <ConfirmarCentroDelAviso
        locale={locale}
        centroDelAvisoId={centroDelAviso}
        centroActivoId={contexto.centroId}
        returnTo={`/${locale}/messages/anuncios/${id}`}
      />
    )
  }

  const anuncio = await getAnuncioDetalle(id, contexto.centroId)
  if (!anuncio) notFound()

  // Solo el autor ve la lista de lectores. El detalle ya viene con
  // `lectores: { total, leidos }` para el contador; el array completo
  // (`lectores_detalle`) alimenta el modal. RLS lo enforza también:
  // un destinatario que invocara la query directamente solo vería su
  // propia fila por la policy `lectura_anuncio_select_self`.
  const lectoresDetalle = anuncio.es_propio ? await getLectoresAnuncio(id) : []

  return <AnuncioView locale={locale} anuncio={anuncio} lectoresDetalle={lectoresDetalle} />
}
