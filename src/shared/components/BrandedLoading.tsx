import { cn } from '@/lib/utils'
import { LogoMark } from './brand/LogoMark'

interface BrandedLoadingProps {
  message?: string
  className?: string
}

export function BrandedLoading({ message, className }: BrandedLoadingProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 py-16 text-center',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <LogoMark size={56} className="animate-pulse" />
      {message && <p className="text-muted-foreground text-sm">{message}</p>}
      <div className="bg-primary-100 relative h-1 w-40 overflow-hidden rounded-full">
        <span className="bg-primary absolute top-0 left-0 h-full w-1/3 animate-[shimmer_1.4s_ease-in-out_infinite] rounded-full" />
      </div>
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  )
}
