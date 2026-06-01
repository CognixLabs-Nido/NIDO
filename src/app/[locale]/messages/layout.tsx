import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getCurrentUser } from '@/features/auth/queries/get-current-user'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { getCentroLogo } from '@/features/centros/queries/get-centro-logo'
import { MessagingBadge } from '@/features/messaging/components/MessagingBadge'
import { countNoLeidos } from '@/features/messaging/queries/count-no-leidos'
import { RecordatoriosBadge } from '@/features/recordatorios/components/RecordatoriosBadge'
import { contarRecordatoriosPendientes } from '@/features/recordatorios/queries/contar-pendientes'
import { SidebarNav } from '@/shared/components/SidebarNav'
import { buildSidebarItems } from '@/shared/lib/sidebar-items'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

/**
 * Layout transversal de mensajería. Es accesible para los 4 roles
 * (admin/profe/tutor_legal/autorizado). La sidebar muestra los items
 * del rol del usuario para que la navegación sea coherente cuando
 * vuelve a /admin, /teacher o /family desde /messages.
 *
 * El servicio role no entra aquí (es solo backend).
 */
export default async function MessagesLayout({ children, params }: LayoutProps) {
  const { locale } = await params
  const tNav = await getTranslations('admin.nav') // 'perfil' es común a los tres roles
  const tRoles = await getTranslations('auth.select_role.roles')

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

  const user = await getCurrentUser()
  const centroLogo = await getCentroLogo(centroId)
  const { total: unread } = await countNoLeidos()
  const recordatoriosPendientes = await contarRecordatoriosPendientes()

  const items = await buildSidebarItems(
    rol,
    locale,
    <MessagingBadge initialTotal={unread} />,
    <RecordatoriosBadge initialTotal={recordatoriosPendientes} />
  )

  const roleLabel =
    rol === 'admin'
      ? tRoles('admin')
      : rol === 'profe'
        ? tRoles('profe')
        : rol === 'autorizado'
          ? tRoles('autorizado')
          : tRoles('tutor_legal')

  return (
    <div className="bg-background flex min-h-[100dvh] flex-col md:flex-row">
      <SidebarNav
        locale={locale}
        items={items}
        user={{
          name: user?.nombreCompleto ?? user?.email ?? tNav('perfil'),
          roleLabel,
        }}
        centroLogo={centroLogo ? { url: centroLogo.logoUrl, name: centroLogo.nombre } : null}
        profileHref={`/${locale}/profile`}
        profileLabel={tNav('perfil')}
        ariaLabel={tNav('aria_label')}
      />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  )
}
