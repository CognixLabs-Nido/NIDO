'use client'

import { DownloadIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

/**
 * El enlace a la copia firmada de la ficha (fase 10c): un PDF que compone el servidor al pedirlo
 * (`/ficha-firmada/[firmaId]`), con la sesión de quien lo pide. No es una URL pública ni se guarda:
 * sin sesión, o sin poder leer la ficha, la ruta da 404.
 */
export function CopiaFichaFirmada({ firmaId }: { firmaId: string }) {
  const t = useTranslations('alta.firma.copia')
  const locale = useLocale()
  return (
    <div className="space-y-1">
      <a
        href={`/${locale}/ficha-firmada/${firmaId}`}
        className="text-primary inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        data-testid="descargar-copia-firmada"
      >
        <DownloadIcon className="size-4" aria-hidden />
        {t('descargar')}
      </a>
      <p className="text-muted-foreground text-xs">{t('ayuda')}</p>
    </div>
  )
}
