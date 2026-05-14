import { cn } from '@/lib/utils'

type SkeletonVariant = 'card' | 'row' | 'form' | 'text'

interface LoadingSkeletonProps {
  variant?: SkeletonVariant
  count?: number
  className?: string
}

const baseBlock = 'bg-muted animate-pulse rounded-lg'

export function LoadingSkeleton({ variant = 'text', count = 1, className }: LoadingSkeletonProps) {
  const items = Array.from({ length: count }, (_, i) => i)

  if (variant === 'card') {
    return (
      <div className={cn('grid gap-4', className)}>
        {items.map((i) => (
          <div key={i} className="bg-card border-border/60 rounded-2xl border p-5 shadow-md">
            <div className={cn(baseBlock, 'mb-3 h-6 w-1/3')} />
            <div className={cn(baseBlock, 'mb-2 h-4 w-2/3')} />
            <div className={cn(baseBlock, 'h-4 w-1/2')} />
          </div>
        ))}
      </div>
    )
  }

  if (variant === 'row') {
    return (
      <div className={cn('space-y-3', className)}>
        {items.map((i) => (
          <div
            key={i}
            className="border-border/60 flex items-center gap-4 border-b pb-3 last:border-b-0"
          >
            <div className={cn(baseBlock, 'h-10 w-10 rounded-full')} />
            <div className="flex-1 space-y-2">
              <div className={cn(baseBlock, 'h-4 w-1/4')} />
              <div className={cn(baseBlock, 'h-3 w-2/5')} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (variant === 'form') {
    return (
      <div className={cn('space-y-4', className)}>
        {items.map((i) => (
          <div key={i} className="space-y-2">
            <div className={cn(baseBlock, 'h-4 w-1/5')} />
            <div className={cn(baseBlock, 'h-8 w-full')} />
          </div>
        ))}
      </div>
    )
  }

  // variant === 'text'
  return (
    <div className={cn('space-y-2', className)}>
      {items.map((i) => (
        <div key={i} className={cn(baseBlock, 'h-4 w-full last:w-2/3')} />
      ))}
    </div>
  )
}
