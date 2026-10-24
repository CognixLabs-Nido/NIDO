import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { PaseServiciosCliente } from '@/features/parte-servicio/components/PaseServiciosCliente'
import { getPaseServicios } from '@/features/parte-servicio/queries/get-pase-servicios'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ fecha?: string; aula?: string }>
}

/**
 * PR-12 — el pase de servicios, un listado único con todos los niños del centro activo. Lo
 * rellena quien esté en el comedor: cualquier profe del centro o Dirección.
 */
export default async function TeacherServiciosPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const { fecha: fechaQuery, aula } = await searchParams
  const t = await getTranslations('parte_servicio')

  const { centroId, rol } = await requireContextoCentro(locale)
  if (rol !== 'profe' && rol !== 'admin') redirect(`/${locale}/forbidden`)

  const fecha = fechaQuery && /^\d{4}-\d{2}-\d{2}$/.test(fechaQuery) ? fechaQuery : hoyMadrid()
  const { filas, error } = await getPaseServicios(centroId, fecha)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>

      {error ? (
        <p className="text-destructive text-sm">{t('listado.error')}</p>
      ) : (
        <PaseServiciosCliente
          key={fecha}
          centroId={centroId}
          locale={locale}
          fecha={fecha}
          filas={filas}
          aulaInicial={aula ?? null}
        />
      )}
    </div>
  )
}
