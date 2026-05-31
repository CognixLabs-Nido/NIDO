import {
  BabyIcon,
  BellIcon,
  BookOpenIcon,
  Building2Icon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  HistoryIcon,
  HomeIcon,
  LayoutDashboardIcon,
  MessageCircleIcon,
  UtensilsIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'

import type { SidebarItem } from '@/shared/components/SidebarNav'

type RoleKey = 'admin' | 'profe' | 'tutor_legal' | 'autorizado'

/**
 * Devuelve los items de sidebar para un rol dado. Incluye el item
 * "Mensajería" en los 3 roles principales con un `trailing` opcional
 * para el badge global de no leídos. Los layouts de admin/teacher/family
 * y la ruta `/messages` consumen este helper para que la sidebar quede
 * idéntica cuando el usuario navega entre módulos.
 */
export async function buildSidebarItems(
  rol: RoleKey,
  locale: string,
  badge?: ReactNode
): Promise<SidebarItem[]> {
  if (rol === 'admin') {
    const t = await getTranslations('admin.nav')
    return [
      { href: `/${locale}/admin`, label: t('dashboard'), icon: <LayoutDashboardIcon /> },
      { href: `/${locale}/admin/centro`, label: t('centro'), icon: <Building2Icon /> },
      { href: `/${locale}/admin/cursos`, label: t('cursos'), icon: <CalendarDaysIcon /> },
      { href: `/${locale}/admin/aulas`, label: t('aulas'), icon: <BookOpenIcon /> },
      { href: `/${locale}/admin/calendario`, label: t('calendario'), icon: <CalendarRangeIcon /> },
      { href: `/${locale}/admin/menus`, label: t('menus'), icon: <UtensilsIcon /> },
      { href: `/${locale}/admin/ninos`, label: t('ninos'), icon: <BabyIcon /> },
      {
        href: `/${locale}/messages`,
        label: t('mensajeria'),
        icon: <MessageCircleIcon />,
        trailing: badge,
      },
      { href: `/${locale}/reminders`, label: t('recordatorios'), icon: <BellIcon /> },
      { href: `/${locale}/admin/audit`, label: t('audit'), icon: <HistoryIcon /> },
    ]
  }

  if (rol === 'profe') {
    const t = await getTranslations('teacher.nav')
    return [
      { href: `/${locale}/teacher`, label: t('dashboard'), icon: <LayoutDashboardIcon /> },
      {
        href: `/${locale}/teacher/calendario`,
        label: t('calendario'),
        icon: <CalendarRangeIcon />,
      },
      {
        href: `/${locale}/messages`,
        label: t('mensajeria'),
        icon: <MessageCircleIcon />,
        trailing: badge,
      },
      { href: `/${locale}/reminders`, label: t('recordatorios'), icon: <BellIcon /> },
    ]
  }

  // tutor_legal y autorizado comparten layout familia.
  const t = await getTranslations('family.nav')
  return [
    { href: `/${locale}/family`, label: t('dashboard'), icon: <HomeIcon /> },
    { href: `/${locale}/family/calendario`, label: t('calendario'), icon: <CalendarRangeIcon /> },
    {
      href: `/${locale}/messages`,
      label: t('mensajeria'),
      icon: <MessageCircleIcon />,
      trailing: badge,
    },
    { href: `/${locale}/reminders`, label: t('recordatorios'), icon: <BellIcon /> },
  ]
}
