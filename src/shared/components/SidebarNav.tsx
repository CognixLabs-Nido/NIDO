'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { CentroLogo } from '@/shared/components/brand/CentroLogo'
import { LogoMark } from '@/shared/components/brand/LogoMark'
import { LogoWordmark } from '@/shared/components/brand/LogoWordmark'
import { cn } from '@/lib/utils'

export interface SidebarItem {
  href: string
  label: string
  icon: ReactNode
}

interface SidebarNavProps {
  locale: string
  items: SidebarItem[]
  user?: {
    name: string
    roleLabel: string
  }
  centroLogo?: { url: string; name: string } | null
  profileHref: string
  profileLabel: string
  ariaLabel: string
}

export function SidebarNav({
  locale: _locale,
  items,
  user,
  centroLogo,
  profileHref,
  profileLabel,
  ariaLabel,
}: SidebarNavProps) {
  const pathname = usePathname()

  function isActive(href: string) {
    if (pathname === href) return true
    // Cualquier subruta cuenta como activa (ej. /admin/ninos/[id] → "Niños").
    return pathname.startsWith(`${href}/`)
  }

  return (
    <>
      {/* Sidebar desktop */}
      <aside
        aria-label={ariaLabel}
        className="bg-sidebar border-sidebar-border sticky top-0 hidden h-[100dvh] w-64 shrink-0 flex-col border-r md:flex"
      >
        <div className="space-y-3 px-5 py-5">
          <LogoWordmark width={140} height={50} />
          {centroLogo && (
            <div className="border-sidebar-border/60 border-t pt-3">
              <CentroLogo url={centroLogo.url} name={centroLogo.name} width={140} height={38} />
            </div>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto px-3">
          <ul className="space-y-1">
            {items.map((item) => {
              const active = isActive(item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group/sb-item relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-neutral-100'
                    )}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="bg-accent-warm-500 absolute top-1 bottom-1 left-0 w-1 rounded-r-full"
                      />
                    )}
                    <span className="text-current [&>svg]:size-5">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="border-sidebar-border border-t p-3">
          <Link
            href={profileHref}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-neutral-100"
          >
            <div className="bg-primary-100 text-primary-700 flex h-9 w-9 items-center justify-center rounded-full font-semibold">
              {(user?.name ?? '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sidebar-foreground truncate text-sm font-medium">
                {user?.name ?? profileLabel}
              </div>
              {user?.roleLabel && (
                <div className="text-muted-foreground truncate text-xs">{user.roleLabel}</div>
              )}
            </div>
          </Link>
        </div>
      </aside>

      {/* Header mobile */}
      <header
        aria-label={ariaLabel}
        className="bg-sidebar border-sidebar-border sticky top-0 z-10 flex flex-col border-b md:hidden"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <LogoMark size={32} />
            {centroLogo && (
              <CentroLogo url={centroLogo.url} name={centroLogo.name} width={104} height={26} />
            )}
          </div>
          <Link
            href={profileHref}
            className="bg-primary-100 text-primary-700 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            aria-label={profileLabel}
          >
            {(user?.name ?? '?').slice(0, 1).toUpperCase()}
          </Link>
        </div>
        <nav className="border-sidebar-border/60 flex gap-1 overflow-x-auto border-t px-3 py-2">
          {items.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/80 hover:bg-neutral-100'
                )}
              >
                <span className="[&>svg]:size-4">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </header>
    </>
  )
}
