import Link from 'next/link'
import type { ReactNode } from 'react'

import { LogoWordmark } from '@/shared/components/brand/LogoWordmark'
import { cn } from '@/lib/utils'

interface AuthShellProps {
  locale: string
  children: ReactNode
  className?: string
}

export function AuthShell({ locale, children, className }: AuthShellProps) {
  return (
    <div
      className={cn(
        'from-primary-100 via-background to-accent-warm-100 relative isolate flex min-h-[100dvh] flex-col items-center bg-gradient-to-br px-4 py-10',
        className
      )}
    >
      <Link
        href={`/${locale}`}
        className="focus-visible:ring-ring mb-6 inline-flex rounded-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <LogoWordmark width={140} height={50} />
      </Link>
      <div className="flex w-full flex-1 items-center justify-center">{children}</div>
    </div>
  )
}
