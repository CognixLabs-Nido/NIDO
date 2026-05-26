import { redirect } from 'next/navigation'

import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { MessagesView } from '@/features/messaging/components/MessagesView'
import { getAnunciosDelUsuario } from '@/features/messaging/queries/get-anuncios'
import { getConversacionDetalle } from '@/features/messaging/queries/get-conversacion-detalle'
import { getNinosMensajeriaParaUsuario } from '@/features/messaging/queries/get-ninos-mensajeria'
import type { ConversacionHeader, MensajeView } from '@/features/messaging/types'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ nino?: string; tab?: string }>
}

/**
 * `/messages` post-Bug 3: WhatsApp-style split-view.
 *
 *  - Para admin: muestra solo el tab Anuncios (decisión F5).
 *  - Para profe/tutor: lista de niños accesibles en la izquierda
 *    (con preview del último mensaje y badge de no leídos) y panel
 *    de conversación a la derecha. Selección por `?nino=<id>`.
 *
 * El SSR carga la conversación del niño seleccionado y los mensajes
 * (filtrados por RLS). Si el niño no tiene conversación todavía, el
 * panel derecho muestra empty state + composer en modo "iniciar".
 */
export default async function MessagesPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const { nino: ninoQuery, tab } = await searchParams

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
  const puedePublicarAnuncio = rol === 'admin' || rol === 'profe'

  // Admin no consume la lista de niños (no participa en conversaciones),
  // pero la query la admite por consistencia. Para evitar query inútil,
  // saltamos la carga.
  const ninos = rol === 'admin' ? [] : await getNinosMensajeriaParaUsuario(centroId, rol)
  const anuncios = await getAnunciosDelUsuario()

  // Resolvemos el niño seleccionado en URL. Si no está en la lista del
  // usuario (manipulación o link viejo), lo ignoramos.
  const ninoSeleccionado =
    ninoQuery && ninos.find((n) => n.nino_id === ninoQuery) ? ninoQuery : null

  let detalleHeader: ConversacionHeader | null = null
  let detalleMensajes: MensajeView[] = []
  let participo = false

  if (ninoSeleccionado) {
    const nino = ninos.find((n) => n.nino_id === ninoSeleccionado)
    if (nino?.conversacion_id) {
      const detalle = await getConversacionDetalle(nino.conversacion_id)
      if (detalle) {
        detalleHeader = detalle.header
        detalleMensajes = detalle.mensajes
        participo = detalle.participo
      }
    } else if (nino) {
      // Niño sin conversación todavía: el composer la crea on-demand.
      // Para que el panel muestre el composer, marcamos participo=true
      // (la RLS hará la verificación real al insertar).
      participo = true
    }
  }

  // Forzamos tab='anuncios' si la URL lo indica (deep-link); cuando hay
  // niño seleccionado, la UI mantiene la pestaña Conversaciones.
  void tab

  return (
    <MessagesView
      locale={locale}
      rol={rol}
      ninos={ninos}
      anuncios={anuncios}
      puedePublicarAnuncio={puedePublicarAnuncio}
      ninoSeleccionadoId={ninoSeleccionado}
      detalleHeader={detalleHeader}
      detalleMensajes={detalleMensajes}
      participo={participo}
    />
  )
}
