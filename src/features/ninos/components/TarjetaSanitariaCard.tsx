import { IdCardIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'
import { SubirDocumentoPdf } from '@/features/alta/components/SubirDocumentoPdf'

import type { TarjetaSanitaria } from '../lib/tarjeta-sanitaria'

interface Props {
  locale: string
  ninoId: string
  /** `null`: la lectura falló (se dice, no se pinta vacío). */
  tarjeta: TarjetaSanitaria | null
  /** URL firmada de la imagen, si la hay y quien mira la ve. */
  urlImagen: string | null
}

/**
 * Fase 7 (2026-11-13): la tarjeta sanitaria en la ficha del niño, para la Dirección y el tutor legal.
 * El número (obligatorio desde el alta; no retroactivo) y la imagen, que la suben la familia o la
 * Dirección cuando quieran y no es obligatoria nunca: anverso y reverso en un PDF, como el DNI de los
 * tutores. Con el alta validada, la imagen de la familia pasa por la cola de Dirección.
 */
export async function TarjetaSanitariaCard({ locale, ninoId, tarjeta, urlImagen }: Props) {
  const t = await getTranslations('nino.tarjeta_sanitaria')
  return (
    <section className="space-y-2" data-testid="tarjeta-sanitaria">
      <h2 className="text-h3 text-foreground flex items-center gap-2">
        <IdCardIcon className="size-5" />
        {t('titulo')}
      </h2>
      <Card>
        <CardContent className="space-y-3 text-sm">
          {tarjeta === null ? (
            <p className="text-muted-foreground text-xs">{t('no_se_pudo_leer')}</p>
          ) : (
            <>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{t('numero')}</span>
                <span className="font-medium" data-testid="tarjeta-sanitaria-numero">
                  {tarjeta.sip ?? t('sin_numero')}
                </span>
              </div>
              {tarjeta.ve_documento && (
                <SubirDocumentoPdf
                  locale={locale}
                  ninoId={ninoId}
                  endpoint="tarjeta-sanitaria"
                  initialUrl={urlImagen}
                  titulo={t('imagen_titulo')}
                  ayuda={t('imagen_ayuda')}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
