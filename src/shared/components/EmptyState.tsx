import Link from 'next/link'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  cta?: {
    label: string
    href?: string
    onClick?: () => void
  }
  className?: string
}

export function EmptyState({ icon, title, description, cta, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className
      )}
    >
      {icon && (
        <div className="text-muted-foreground [&>svg]:size-12" aria-hidden>
          {icon}
        </div>
      )}
      <h3 className="text-h3 text-foreground">{title}</h3>
      {description && <p className="text-muted-foreground max-w-sm text-sm">{description}</p>}
      {cta && (
        <div className="mt-2">
          {cta.href ? (
            <Button render={<Link href={cta.href} />}>{cta.label}</Button>
          ) : (
            <Button onClick={cta.onClick}>{cta.label}</Button>
          )}
        </div>
      )}
    </div>
  )
}
