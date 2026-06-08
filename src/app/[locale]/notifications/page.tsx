import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { MarcarVistasOnMount } from '@/features/notificaciones/components/MarcarVistasOnMount'
import { NovedadesLista } from '@/features/notificaciones/components/NovedadesLista'
import type { RolNotif } from '@/features/notificaciones/lib/helpers'
import { getNovedades } from '@/features/notificaciones/queries/get-novedades'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * Centro de notificaciones (punto 3, C1): novedades del ámbito del rol (excursiones,
 * personas autorizadas, medicación/administraciones) con marca de no leído. Al abrir,
 * sella el marcador `visto_at` → el badge del sidebar baja a 0 en la próxima navegación.
 */
export default async function NotificationsPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('notificaciones')

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
  const rol = rolRaw as RolNotif

  const novedades = await getNovedades(rol, locale)

  return (
    <div className="space-y-6">
      <MarcarVistasOnMount />
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>
      <NovedadesLista items={novedades} />
    </div>
  )
}
