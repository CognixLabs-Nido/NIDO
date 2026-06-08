import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { AgendaBadge } from '@/features/agenda/components/AgendaBadge'
import { contarInvitacionesPendientes } from '@/features/agenda/queries/contar-invitaciones-pendientes'
import { getCurrentUser } from '@/features/auth/queries/get-current-user'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { getCentroLogo } from '@/features/centros/queries/get-centro-logo'
import { MessagingBadge } from '@/features/messaging/components/MessagingBadge'
import { countNoLeidos } from '@/features/messaging/queries/count-no-leidos'
import { NotificacionesBadge } from '@/features/notificaciones/components/NotificacionesBadge'
import { contarNovedadesNoLeidas } from '@/features/notificaciones/queries/contar-novedades-no-leidas'
import { RecordatoriosBadge } from '@/features/recordatorios/components/RecordatoriosBadge'
import { contarRecordatoriosPendientes } from '@/features/recordatorios/queries/contar-pendientes'
import { SidebarNav } from '@/shared/components/SidebarNav'
import { buildSidebarItems } from '@/shared/lib/sidebar-items'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function TeacherLayout({ children, params }: LayoutProps) {
  const { locale } = await params
  const t = await getTranslations('teacher.nav')
  const tRoles = await getTranslations('auth.select_role.roles')
  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)

  const rol = await getRolEnCentro(centroId)
  if (rol !== 'profe' && rol !== 'admin') redirect(`/${locale}/forbidden`)

  const user = await getCurrentUser()
  const centroLogo = await getCentroLogo(centroId)
  const { total: unread } = await countNoLeidos()
  const recordatoriosPendientes = await contarRecordatoriosPendientes()
  const invitacionesPendientes = await contarInvitacionesPendientes()
  const novedades = await contarNovedadesNoLeidas()

  const items = await buildSidebarItems(
    rol === 'admin' ? 'admin' : 'profe',
    locale,
    <MessagingBadge initialTotal={unread} />,
    <RecordatoriosBadge initialTotal={recordatoriosPendientes} />,
    <AgendaBadge initialTotal={invitacionesPendientes} />,
    <NotificacionesBadge initialTotal={novedades} />
  )

  return (
    <div className="bg-background flex min-h-[100dvh] flex-col md:flex-row">
      <SidebarNav
        locale={locale}
        items={items}
        user={{
          name: user?.nombreCompleto ?? user?.email ?? t('perfil'),
          roleLabel: tRoles('profe'),
        }}
        centroLogo={centroLogo ? { url: centroLogo.logoUrl, name: centroLogo.nombre } : null}
        profileHref={`/${locale}/profile`}
        profileLabel={t('perfil')}
        ariaLabel={t('aria_label')}
      />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  )
}
