import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{ locale: string; ninoId: string }>
}

/**
 * Punto de entrada "Escribir a la familia/profe" desde la ficha de un niño.
 *
 * Tras el rediseño WhatsApp-style de `/messages` (Bug 3 post-F5), esta ruta
 * redirige al split-view con el niño preseleccionado mediante query param.
 *  - Si ya hay conversación: el panel derecho la carga vía SSR.
 *  - Si no la hay: el composer se renderiza en modo "iniciar" y crea la
 *    conversación al enviar el primer mensaje.
 *
 * La RLS de `/messages` filtra: si el niño no es accesible al usuario, la
 * lista no lo incluye y el detalle no se carga (no se expone información).
 */
export default async function MessagesNinoPage({ params }: PageProps) {
  const { locale, ninoId } = await params
  redirect(`/${locale}/messages?nino=${encodeURIComponent(ninoId)}`)
}
