import { getTranslations } from 'next-intl/server'

import { SignOutButton } from '@/features/auth/components/SignOutButton'
import { TarjetaCentro } from '@/features/plataforma/components/TarjetaCentro'
import { getMetricasPlataforma } from '@/features/plataforma/queries/get-metricas-plataforma'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * Panel de plataforma (Fase 5, PR 1): los centros vivos con sus recuentos de lo activo y sus
 * alertas, y «Entrar» en cada uno. Solo cifras: ningún nombre de niño, familia ni persona, así que
 * mirar el panel no se audita (decisión del responsable); entrar en un centro sí.
 */
export default async function PlataformaPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('plataforma')
  const centros = await getMetricasPlataforma()

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-h1 text-foreground">{t('titulo')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitulo')}</p>
        </div>
        <SignOutButton locale={locale} />
      </header>
      {centros === null ? (
        <p role="alert" className="text-destructive text-sm">
          {t('error_carga')}
        </p>
      ) : centros.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('vacio')}</p>
      ) : (
        <div className="space-y-4">
          {centros.map((c) => (
            <TarjetaCentro key={c.centroId} centro={c} locale={locale} />
          ))}
        </div>
      )}
    </>
  )
}
