import Image from 'next/image'

import { cn } from '@/lib/utils'

interface LogoWordmarkProps {
  className?: string
  priority?: boolean
  width?: number
  height?: number
}

export function LogoWordmark({
  className,
  priority = false,
  width = 180,
  height = 64,
}: LogoWordmarkProps) {
  return (
    <Image
      src="/brand/nido-logo-wordmark.png"
      alt="NIDO"
      width={width}
      height={height}
      priority={priority}
      className={cn('h-auto select-none', className)}
    />
  )
}
