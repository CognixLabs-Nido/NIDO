import Link from 'next/link'
import type { ReactNode } from 'react'

import { LogoWordmark } from '@/shared/components/brand/LogoWordmark'

interface LegalShellProps {
  locale: string
  title: string
  children: ReactNode
}

export function LegalShell({ locale, title, children }: LegalShellProps) {
  return (
    <div className="bg-background min-h-[100dvh]">
      <header className="border-border/60 bg-card border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link
            href={`/${locale}`}
            className="focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <LogoWordmark width={120} height={42} />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-h1 text-foreground mb-6">{title}</h1>
        <div className="text-foreground/90 space-y-4 text-base leading-relaxed">{children}</div>
      </main>
    </div>
  )
}
