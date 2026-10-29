import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Card } from '@/components/ui/card'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { RetencionLista } from '@/features/datos-bloqueados/components/RetencionLista'
import {
  getRetencionesCentro,
  getSujetosRetencion,
} from '@/features/datos-bloqueados/queries/get-datos-bloqueados'
import { localeIntl } from '@/shared/lib/locale-intl'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * La retención por procedimiento abierto (20261206120000), solo para la titular: todos los sujetos
 * del centro, para poner o quitar la retención a varios de golpe, y debajo el registro de quién la
 * puso o la quitó, cuándo y por qué.
 */
export default async function RetencionPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('datos_bloqueados')
  const { centroId, esResponsable } = await requireContextoCentro(locale)
  if (!esResponsable) redirect(`/${locale}/forbidden`)

  const sujetos = await getSujetosRetencion(centroId)
  // El superusuario es responsable en la app, pero no titular: la BD le contesta 42501.
  if (sujetos.tipo === 'no_autorizado') redirect(`/${locale}/forbidden`)
  const registro = await getRetencionesCentro(centroId)

  const fechaHora = new Intl.DateTimeFormat(localeIntl(locale), {
    timeZone: 'Europe/Madrid',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href={`/${locale}/admin/datos-bloqueados`}
          className="text-primary text-sm underline-offset-4 hover:underline"
        >
          {t('volver')}
        </Link>
        <h1 className="text-h1 text-foreground">{t('retencion.titulo')}</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">{t('retencion.descripcion')}</p>
      </header>

      {sujetos.tipo === 'error' ? (
        <Card className="text-destructive p-6 text-sm" role="alert">
          {t('error_lectura')}
        </Card>
      ) : (
        <RetencionLista centroId={centroId} filas={sujetos.filas} />
      )}

      <section className="space-y-2">
        <h2 className="text-h3 text-foreground">{t('retencion.registro_titulo')}</h2>
        {registro.tipo !== 'ok' ? (
          <Card className="text-destructive p-6 text-sm" role="alert">
            {t('error_lectura')}
          </Card>
        ) : registro.filas.length === 0 ? (
          <Card className="text-muted-foreground p-6 text-sm">{t('retencion.registro_vacio')}</Card>
        ) : (
          <Card className="divide-y">
            {registro.filas.map((r, i) => (
              <div key={i} className="space-y-1 p-4 text-sm">
                <p className="text-foreground">
                  {t('retencion.registro_puesta', {
                    fecha: fechaHora.format(new Date(r.puesta_en)),
                    quien: r.puesta_por_nombre ?? t('cuenta_borrada'),
                    sujeto: r.sujeto_nombre || t('retencion.sin_nombre'),
                  })}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t(`motivos.${r.motivo_tipo}`)}: {r.motivo}
                </p>
                {r.quitada_en && (
                  <p className="text-muted-foreground text-xs">
                    {t('retencion.registro_quitada', {
                      fecha: fechaHora.format(new Date(r.quitada_en)),
                      quien: r.quitada_por_nombre ?? t('cuenta_borrada'),
                      motivo: r.quitada_motivo ?? '',
                    })}
                  </p>
                )}
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  )
}
