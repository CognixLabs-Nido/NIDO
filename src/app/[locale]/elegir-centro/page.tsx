import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SelectorCentro } from '@/features/centros/components/SelectorCentro'
import { getEstadoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { rutaDeVuelta } from '@/features/centros/contexto/ruta-de-vuelta'
import { getNombresCentros } from '@/features/centros/queries/get-nombres-centros'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ returnTo?: string }>
}

/**
 * Selector de centro (multicentro · Fase 1). Solo lo ve quien tiene MÁS de un centro: con uno,
 * se sigue directo. No escribe la cookie al pintarse (MisterFC #756): la escribe la acción al
 * elegir.
 */
export default async function ElegirCentroPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const { returnTo } = await searchParams
  const estado = await getEstadoCentro()

  if (estado.tipo === 'sin_sesion') redirect(`/${locale}/login`)
  if (estado.tipo === 'sin_centro') redirect(`/${locale}/forbidden`)

  const centros = estado.tipo === 'activo' ? estado.contexto.centros : estado.centros
  if (centros.length < 2) redirect(rutaDeVuelta(locale, returnTo))

  const t = await getTranslations('centros.elegir')
  const nombres = await getNombresCentros(centros.map((c) => c.centroId))
  const opciones = centros.map((c) => ({
    centroId: c.centroId,
    nombre: nombres.get(c.centroId) ?? t('sin_nombre'),
  }))

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('titulo')}</CardTitle>
          <CardDescription>{t('subtitulo')}</CardDescription>
        </CardHeader>
        <CardContent>
          <SelectorCentro
            locale={locale}
            centros={opciones}
            returnTo={returnTo ?? null}
            actual={estado.tipo === 'activo' ? estado.contexto.centroId : undefined}
          />
        </CardContent>
      </Card>
    </div>
  )
}
