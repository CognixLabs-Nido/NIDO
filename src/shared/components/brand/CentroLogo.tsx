import Image from 'next/image'

interface CentroLogoProps {
  url: string
  name: string
  width?: number
  height?: number
  className?: string
  priority?: boolean
}

/**
 * Logo del centro (ej. ANAIA). Se renderiza debajo del wordmark NIDO en la
 * sidebar/header de los layouts admin/teacher/family. La URL viene de
 * `centros.logo_url` (asset relativo en `public/brand/...` durante Ola 1;
 * URL firmada de Supabase Storage cuando se implemente en Fase 10).
 */
export function CentroLogo({
  url,
  name,
  width = 140,
  height = 38,
  className,
  priority,
}: CentroLogoProps) {
  return (
    <Image
      src={url}
      alt={name}
      width={width}
      height={height}
      className={className}
      priority={priority}
    />
  )
}
