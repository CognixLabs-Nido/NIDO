import Image from 'next/image'

import { cn } from '@/lib/utils'

interface LogoMarkProps {
  className?: string
  priority?: boolean
  size?: number
}

export function LogoMark({ className, priority = false, size = 40 }: LogoMarkProps) {
  return (
    <Image
      src="/brand/nido-logo-mark.png"
      alt="NIDO"
      width={size}
      height={size}
      priority={priority}
      className={cn('select-none', className)}
    />
  )
}
