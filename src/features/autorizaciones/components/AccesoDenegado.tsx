import { ArrowLeftIcon, LockIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

/**
 * Mensaje "no tienes acceso" EN LA MISMA PÁGINA (no cierra sesión, no redirige a una
 * página aparte). Se muestra cuando el usuario abre una autorización que no puede ver
 * (p. ej. desde una notificación a una instancia fuera de su ámbito). Server component.
 */
export async function AccesoDenegado({ volverHref }: { volverHref: string }) {
  const t = await getTranslations('autorizaciones')
  return (
    <div className="space-y-6">
      <div>
        <Link
          href={volverHref}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-4" />
          {t('volver')}
        </Link>
      </div>
      <div className="flex flex-col items-center gap-3 rounded-xl border p-8 text-center">
        <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
          <LockIcon className="size-6" />
        </span>
        <h1 className="text-h3 text-foreground">{t('sin_acceso.titulo')}</h1>
        <p className="text-muted-foreground max-w-md text-sm">{t('sin_acceso.descripcion')}</p>
      </div>
    </div>
  )
}
