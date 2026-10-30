import { LockIcon } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'

import { localeIntl } from '@/shared/lib/locale-intl'

/**
 * La ficha médica bloqueada al terminar el curso de la baja (20261204120000). Se dice que existe,
 * desde cuándo y por qué: enseñarla como «sin datos» sería mentir. A Dirección no se le da el
 * motivo: también la del niño purgado está bloqueada (20261210120000), y el porqué y las fechas de
 * cada dato están en el cuadro de conservación de su ficha (20261211120000).
 */
export async function FichaMedicaBloqueada({
  desde,
  paraDireccion = false,
}: {
  desde: string
  paraDireccion?: boolean
}) {
  const t = await getTranslations('medico')
  const locale = await getLocale()
  // Una fecha sin hora: se lee y se escribe en UTC para que no cambie de día.
  const fecha = new Intl.DateTimeFormat(localeIntl(locale), {
    timeZone: 'UTC',
    dateStyle: 'long',
  }).format(new Date(`${desde}T00:00:00Z`))

  return (
    <div className="border-warm-300 bg-warm-50 text-warm-800 space-y-1 rounded-md border-l-4 px-3 py-2 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <LockIcon className="size-4" />
        {t('bloqueada_titulo')}
      </p>
      <p>{t(paraDireccion ? 'bloqueada_direccion' : 'bloqueada', { fecha })}</p>
    </div>
  )
}
