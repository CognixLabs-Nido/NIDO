import Image from 'next/image'

import { cn } from '@/lib/utils'

interface LogoProps {
  className?: string
  priority?: boolean
  width?: number
  height?: number
}

export function Logo({ className, priority = false, width = 320, height = 355 }: LogoProps) {
  return (
    <Image
      src="/brand/nido-logo-full.png"
      alt="NIDO"
      width={width}
      height={height}
      priority={priority}
      className={cn('h-auto select-none', className)}
    />
  )
}
