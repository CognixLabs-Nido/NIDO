import 'server-only'

import { Building2Icon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import { getNombresCentros } from '../queries/get-nombres-centros'

import { SelectorCentro } from './SelectorCentro'

interface Props {
  locale: string
  /** Centro de la notificación: otro de los del usuario (`centroDelAvisoPorConfirmar`). */
  centroDelAvisoId: string
  centroActivoId: string
  /** A dónde volver tras cambiar: la conversación o el anuncio, sin `?centro=`. */
  returnTo: string
}

/**
 * Se pinta EN LUGAR de la página cuando una notificación es de otro centro del usuario. No
 * escribe la cookie al pintarse (MisterFC #756): el botón llama a `elegirCentro`, que valida el
 * centro, la escribe y vuelve a `returnTo`. Hermano de `AvisoCentroDistinto`, que avisa sin
 * bloquear en las páginas que se enseñan desde cualquier centro.
 */
export async function ConfirmarCentroDelAviso({
  locale,
  centroDelAvisoId,
  centroActivoId,
  returnTo,
}: Props) {
  const t = await getTranslations('centros')
  const nombres = await getNombresCentros([centroDelAvisoId, centroActivoId])
  const nombre = (id: string) => nombres.get(id) ?? t('elegir.sin_nombre')

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2Icon className="size-5 shrink-0" aria-hidden />
          {t('notificacion.titulo')}
        </CardTitle>
        <CardDescription>
          {t('notificacion.texto', {
            centro: nombre(centroDelAvisoId),
            activo: nombre(centroActivoId),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SelectorCentro
          locale={locale}
          centros={[
            {
              centroId: centroDelAvisoId,
              nombre: t('notificacion.cambiar', { centro: nombre(centroDelAvisoId) }),
            },
          ]}
          returnTo={returnTo}
        />
      </CardContent>
    </Card>
  )
}
