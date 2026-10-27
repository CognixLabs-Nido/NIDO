import { EyeIcon } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'
import { localeIntl } from '@/shared/lib/locale-intl'

import { ExportButton } from '@/features/export/components/ExportButton'

import type { RegistroLecturas } from '../queries/get-lecturas-ficha-medica'

/**
 * Quién ha leído la ficha médica del niño (F11-B, punto 4): cuándo, quién, por qué pudo y qué
 * campos vio. Lo ven los tutores legales y la Dirección; a quien no, no se le enseña nada.
 * `descargaHref`: la descarga para entregar a la familia (la ficha de Dirección).
 */
export async function LecturasFichaMedica({
  registro,
  descargaHref,
}: {
  registro: RegistroLecturas
  descargaHref?: string
}) {
  if (registro.tipo === 'no_autorizado') return null
  const t = await getTranslations('ficha_medica_lecturas')
  const locale = await getLocale()
  const fmt = new Intl.DateTimeFormat(localeIntl(locale), {
    timeZone: 'Europe/Madrid',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <section className="space-y-3" aria-labelledby="lecturas-ficha-medica">
      <h3
        id="lecturas-ficha-medica"
        className="text-foreground flex items-center gap-2 font-medium"
      >
        <EyeIcon className="text-muted-foreground size-4" />
        {t('titulo')}
      </h3>
      <p className="text-muted-foreground text-sm">{t('explicacion')}</p>
      {descargaHref && registro.tipo === 'ok' && (
        <ExportButton
          href={descargaHref}
          label={t('descargar')}
          filename="nido-registro-ficha-medica.html"
          size="sm"
        />
      )}
      {registro.tipo === 'error' ? (
        <p className="text-destructive text-sm" role="alert">
          {t('error')}
        </p>
      ) : registro.lecturas.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('vacio')}</p>
      ) : (
        <Card>
          <CardContent className="divide-y divide-dashed divide-neutral-200 text-sm">
            {registro.lecturas.map((l, i) => (
              <div key={i} className="space-y-1 py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-foreground font-medium">
                    {l.lector ?? t('cuenta_borrada')}
                  </span>
                  <time className="text-muted-foreground text-xs" dateTime={l.leidaEn}>
                    {fmt.format(new Date(l.leidaEn))}
                  </time>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t(`rol.${l.rol}`)} · {t(`origen.${l.origen}`)}
                </p>
                <p className="text-foreground text-xs">
                  {l.campos.length === 0
                    ? t('sin_datos')
                    : `${t('vio')}: ${l.campos.map((c) => t(`campo.${c}`)).join(', ')}`}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  )
}
