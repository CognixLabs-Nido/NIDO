import {
  BabyIcon,
  BellIcon,
  BookOpenIcon,
  Building2Icon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  FileSignatureIcon,
  HistoryIcon,
  HomeIcon,
  InboxIcon,
  LayoutDashboardIcon,
  MessageCircleIcon,
  UtensilsIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'

import type { SidebarItem } from '@/shared/components/SidebarNav'

type RoleKey = 'admin' | 'profe' | 'tutor_legal' | 'autorizado'

/**
 * Devuelve los items de sidebar para un rol dado. Incluye los items
 * "Mensajería" y "Recordatorios" en los 4 roles con `trailing` opcionales
 * para sus badges globales (no leídos / pendientes). Los layouts de
 * admin/teacher/family y las rutas `/messages` y `/reminders` consumen este
 * helper para que la sidebar quede idéntica cuando el usuario navega entre
 * módulos.
 *
 * F6-C: tutor_legal/autorizado vuelven a tener la entrada "Recordatorios"
 * (revierte el hotfix #44, que la ocultó). Solo LEEN — el botón de creación se
 * gobierna en la propia página, no aquí.
 */
export async function buildSidebarItems(
  rol: RoleKey,
  locale: string,
  badge?: ReactNode,
  recordatoriosBadge?: ReactNode,
  agendaBadge?: ReactNode,
  notificacionesBadge?: ReactNode
): Promise<SidebarItem[]> {
  if (rol === 'admin') {
    const t = await getTranslations('admin.nav')
    return [
      { href: `/${locale}/admin`, label: t('dashboard'), icon: <LayoutDashboardIcon /> },
      { href: `/${locale}/admin/centro`, label: t('centro'), icon: <Building2Icon /> },
      { href: `/${locale}/admin/cursos`, label: t('cursos'), icon: <CalendarDaysIcon /> },
      { href: `/${locale}/admin/aulas`, label: t('aulas'), icon: <BookOpenIcon /> },
      { href: `/${locale}/admin/calendario`, label: t('calendario'), icon: <CalendarRangeIcon /> },
      {
        href: `/${locale}/agenda`,
        label: t('agenda'),
        icon: <CalendarCheckIcon />,
        trailing: agendaBadge,
      },
      { href: `/${locale}/admin/menus`, label: t('menus'), icon: <UtensilsIcon /> },
      {
        href: `/${locale}/admin/autorizaciones`,
        label: t('autorizaciones'),
        icon: <FileSignatureIcon />,
      },
      { href: `/${locale}/admin/ninos`, label: t('ninos'), icon: <BabyIcon /> },
      {
        href: `/${locale}/messages`,
        label: t('mensajeria'),
        icon: <MessageCircleIcon />,
        trailing: badge,
      },
      {
        href: `/${locale}/reminders`,
        label: t('recordatorios'),
        icon: <BellIcon />,
        trailing: recordatoriosBadge,
      },
      {
        href: `/${locale}/notifications`,
        label: t('notificaciones'),
        icon: <InboxIcon />,
        trailing: notificacionesBadge,
      },
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
        href: `/${locale}/agenda`,
        label: t('agenda'),
        icon: <CalendarCheckIcon />,
        trailing: agendaBadge,
      },
      // La profe entra a la ruta admin de autorizaciones (la page admite rol
      // 'profe'): cataloga salidas de sus eventos, firma roster y administra
      // medicación de su aula. Antes no tenía ninguna entrada → era el bloqueo.
      {
        href: `/${locale}/admin/autorizaciones`,
        label: t('autorizaciones'),
        icon: <FileSignatureIcon />,
      },
      {
        href: `/${locale}/messages`,
        label: t('mensajeria'),
        icon: <MessageCircleIcon />,
        trailing: badge,
      },
      {
        href: `/${locale}/reminders`,
        label: t('recordatorios'),
        icon: <BellIcon />,
        trailing: recordatoriosBadge,
      },
      {
        href: `/${locale}/notifications`,
        label: t('notificaciones'),
        icon: <InboxIcon />,
        trailing: notificacionesBadge,
      },
    ]
  }

  // tutor_legal y autorizado comparten layout familia. F6-C: vuelven a ver
  // "Recordatorios" (solo lectura — reciben broadcasts del centro/aula/familia).
  const t = await getTranslations('family.nav')
  return [
    { href: `/${locale}/family`, label: t('dashboard'), icon: <HomeIcon /> },
    { href: `/${locale}/family/calendario`, label: t('calendario'), icon: <CalendarRangeIcon /> },
    {
      href: `/${locale}/family/autorizaciones`,
      label: t('autorizaciones'),
      icon: <FileSignatureIcon />,
    },
    {
      href: `/${locale}/agenda`,
      label: t('agenda'),
      icon: <CalendarCheckIcon />,
      trailing: agendaBadge,
    },
    {
      href: `/${locale}/messages`,
      label: t('mensajeria'),
      icon: <MessageCircleIcon />,
      trailing: badge,
    },
    {
      href: `/${locale}/reminders`,
      label: t('recordatorios'),
      icon: <BellIcon />,
      trailing: recordatoriosBadge,
    },
    {
      href: `/${locale}/notifications`,
      label: t('notificaciones'),
      icon: <InboxIcon />,
      trailing: notificacionesBadge,
    },
  ]
}
