import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'
import { MensajeComposer } from '@/features/messaging/components/MensajeComposer'
import { getConversacionByNino } from '@/features/messaging/queries/get-conversacion-by-nino'
import { getNinoById } from '@/features/ninos/queries/get-ninos'

interface PageProps {
  params: Promise<{ locale: string; ninoId: string }>
}

/**
 * Punto de entrada "Escribir a la familia/profe" desde la ficha de un niño.
 *  - Si ya existe conversación → redirect a `/messages/conversacion/[id]`.
 *  - Si no → composer aislado que crea la conversación al enviar y
 *    redirige al hilo recién creado.
 *
 * RLS: la consulta `getConversacionByNino` solo devuelve resultado si
 * el usuario es participante. Si el niño no es accesible o el usuario
 * carece de permiso, devolvemos 404 implícito vía `notFound()`.
 */
export default async function MessagesNinoPage({ params }: PageProps) {
  const { locale, ninoId } = await params
  const t = await getTranslations('messages.conversacion')

  const existing = await getConversacionByNino(ninoId)
  if (existing) {
    redirect(`/${locale}/messages/conversacion/${existing}`)
  }

  const nino = await getNinoById(ninoId)
  if (!nino) redirect(`/${locale}/messages`)

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col">
      <header className="bg-background sticky top-0 z-[1] -mx-4 border-b px-4 py-3 md:-mx-8 md:px-8">
        <div className="flex items-center gap-3">
          <Link
            href={`/${locale}/messages`}
            aria-label={t('volver')}
            className="text-muted-foreground hover:bg-muted/40 inline-flex h-9 w-9 items-center justify-center rounded-md"
          >
            <ArrowLeftIcon className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">
              {t('title', { nombre: nino.nombre })}
            </h1>
          </div>
        </div>
      </header>

      <div className="flex-1 py-4">
        <Card>
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            {t('sin_mensajes')}
          </CardContent>
        </Card>
      </div>

      <MensajeComposer ninoId={ninoId} locale={locale} redirectOnFirstSend />
    </div>
  )
}
