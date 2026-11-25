'use client'

import { CloudOffIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  /** `pagina`: la pantalla entera no se pudo leer; `seccion`: solo esta parte, el resto sigue. */
  alcance: 'pagina' | 'seccion'
  /** Lo que hace «Reintentar». Por defecto, volver a pedir la página al servidor. */
  reintentar?: () => void
  className?: string
}

/**
 * La pieza común que dice «no se ha podido leer» (censo C, 2026-11-25). Nunca «no hay»: una lectura que
 * falló no es una lista vacía. La usan el `error.tsx` de cada sección (la página entera) y `LimiteSeccion`
 * y las pantallas diarias (una parte, con el resto funcionando).
 */
export function NoSePudoLeer({ alcance, reintentar, className }: Props) {
  const t = useTranslations('common.lectura')
  const router = useRouter()
  return (
    <div
      role="alert"
      data-testid={alcance === 'pagina' ? 'no-se-pudo-leer-pagina' : 'no-se-pudo-leer-seccion'}
      className={cn(
        'flex flex-col items-center gap-2 text-center',
        alcance === 'pagina' ? 'px-6 py-16' : 'border-warning-300 rounded-md border px-3 py-4',
        className
      )}
    >
      <CloudOffIcon className="text-muted-foreground size-8" aria-hidden />
      <p className="text-foreground text-sm font-medium">
        {alcance === 'pagina' ? t('pagina') : t('seccion')}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => (reintentar ? reintentar() : router.refresh())}
      >
        {t('reintentar')}
      </Button>
    </div>
  )
}
