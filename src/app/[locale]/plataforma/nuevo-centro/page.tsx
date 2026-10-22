import { getTranslations } from 'next-intl/server'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { NuevoCentroForm } from '@/features/plataforma/components/NuevoCentroForm'
import { cursoPorFecha } from '@/features/plataforma/lib/curso-por-fecha'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * Crear un centro desde la plataforma (Fase 5, PR 2). La gatean el proxy y el layout de
 * `/plataforma`, y la BD (`platform_crear_centro` empieza por `is_superadmin`). El curso sale
 * calculado por la fecha de hoy en Madrid.
 */
export default async function NuevoCentroPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('plataforma.nuevo')

  return (
    <>
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('titulo')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitulo')}</p>
      </header>
      <NuevoCentroForm locale={locale} curso={cursoPorFecha(hoyMadrid())} />
    </>
  )
}
