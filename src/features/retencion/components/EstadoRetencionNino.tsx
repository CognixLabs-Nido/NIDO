import { ArchiveIcon } from 'lucide-react'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'
import { localeIntl } from '@/shared/lib/locale-intl'

import { lineasEstado } from '../lib/lineas-estado'
import type { EstadoRetencionNino as Estado } from '../queries/get-estado-retencion-nino'

/**
 * El cuadro de conservación del niño: una línea por dato, con su fecha o con el motivo de que no la
 * haya (20261211120000). Lo ve Dirección. El camino a lo bloqueado sale solo cuando la BD dice que
 * quien mira es la admin y hay algo que ver: a la directora no se le enseña una puerta cerrada.
 */
export async function EstadoRetencionNino({ estado, ninoId }: { estado: Estado; ninoId: string }) {
  const t = await getTranslations('retencion_estado')
  const locale = await getLocale()
  // Una fecha sin hora: se lee y se escribe en UTC para que no cambie de día.
  const fmt = new Intl.DateTimeFormat(localeIntl(locale), { timeZone: 'UTC', dateStyle: 'long' })
  const fecha = (iso: string) => fmt.format(new Date(`${iso}T00:00:00Z`))

  return (
    <Card>
      <CardContent className="space-y-3 text-sm">
        <h2 className="text-h3 text-foreground flex items-center gap-2">
          <ArchiveIcon className="size-4" />
          {t('titulo')}
        </h2>
        {estado.estado === 'activo' ? (
          <p className="text-muted-foreground">{t('activo')}</p>
        ) : (
          <>
            {estado.retenido && (
              <p className="border-warm-300 bg-warm-50 text-warm-800 rounded-md border-l-4 px-3 py-2">
                {t('retenido')}
              </p>
            )}
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[max-content_1fr]">
              {lineasEstado(estado, (k, v) => t(k, v), fecha).map((l) => (
                <div key={l.clave} className="contents">
                  <dt className="text-muted-foreground font-medium">{l.etiqueta}</dt>
                  <dd>{l.texto}</dd>
                </div>
              ))}
            </dl>
            <p className="text-muted-foreground text-xs">{t('provisionales')}</p>
            {estado.puede_ver_bloqueado && (
              <Link
                href={`/${locale}/admin/datos-bloqueados/nino/${ninoId}`}
                className="text-primary text-sm underline-offset-4 hover:underline"
              >
                {t('ver_bloqueados')}
              </Link>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
