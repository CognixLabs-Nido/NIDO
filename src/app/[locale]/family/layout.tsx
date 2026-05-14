import { HomeIcon } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getCurrentUser } from '@/features/auth/queries/get-current-user'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { SidebarNav, type SidebarItem } from '@/shared/components/SidebarNav'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function FamilyLayout({ children, params }: LayoutProps) {
  const { locale } = await params
  const t = await getTranslations('family.nav')
  const tRoles = await getTranslations('auth.select_role.roles')
  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)

  const rol = await getRolEnCentro(centroId)
  if (rol !== 'tutor_legal' && rol !== 'autorizado' && rol !== 'admin') {
    redirect(`/${locale}/forbidden`)
  }

  const user = await getCurrentUser()

  const items: SidebarItem[] = [
    {
      href: `/${locale}/family`,
      label: t('dashboard'),
      icon: <HomeIcon />,
    },
  ]

  return (
    <div className="bg-background flex min-h-[100dvh] flex-col md:flex-row">
      <SidebarNav
        locale={locale}
        items={items}
        user={{
          name: user?.nombreCompleto ?? user?.email ?? t('perfil'),
          roleLabel: rol === 'autorizado' ? tRoles('autorizado') : tRoles('tutor_legal'),
        }}
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
