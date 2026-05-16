import {
  LayoutDashboardIcon,
  Building2Icon,
  CalendarDaysIcon,
  BookOpenIcon,
  BabyIcon,
  HistoryIcon,
  UtensilsCrossedIcon,
} from 'lucide-react'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getCurrentUser } from '@/features/auth/queries/get-current-user'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { getCentroLogo } from '@/features/centros/queries/get-centro-logo'
import { SidebarNav, type SidebarItem } from '@/shared/components/SidebarNav'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function AdminLayout({ children, params }: LayoutProps) {
  const { locale } = await params
  const t = await getTranslations('admin.nav')
  const tRoles = await getTranslations('auth.select_role.roles')
  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)

  const rol = await getRolEnCentro(centroId)
  if (rol !== 'admin') redirect(`/${locale}/forbidden`)

  const user = await getCurrentUser()
  const centroLogo = await getCentroLogo(centroId)

  const items: SidebarItem[] = [
    {
      href: `/${locale}/admin`,
      label: t('dashboard'),
      icon: <LayoutDashboardIcon />,
    },
    { href: `/${locale}/admin/centro`, label: t('centro'), icon: <Building2Icon /> },
    { href: `/${locale}/admin/cursos`, label: t('cursos'), icon: <CalendarDaysIcon /> },
    { href: `/${locale}/admin/aulas`, label: t('aulas'), icon: <BookOpenIcon /> },
    { href: `/${locale}/admin/ninos`, label: t('ninos'), icon: <BabyIcon /> },
    { href: `/${locale}/admin/menus`, label: t('menus'), icon: <UtensilsCrossedIcon /> },
    { href: `/${locale}/admin/audit`, label: t('audit'), icon: <HistoryIcon /> },
  ]

  return (
    <div className="bg-background flex min-h-[100dvh] flex-col md:flex-row">
      <SidebarNav
        locale={locale}
        items={items}
        user={{
          name: user?.nombreCompleto ?? user?.email ?? t('perfil'),
          roleLabel: tRoles('admin'),
        }}
        centroLogo={centroLogo ? { url: centroLogo.logoUrl, name: centroLogo.nombre } : null}
        profileHref={`/${locale}/profile`}
        profileLabel={t('perfil')}
        ariaLabel={t('aria_label')}
      />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  )
}
