import { getTranslations } from 'next-intl/server'

import { ColaCambiosPendientes } from '@/features/cambios-pendientes/components/ColaCambiosPendientes'
import { listarCambiosPendientes } from '@/features/cambios-pendientes/queries/get-cola'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'

export const dynamic = 'force-dynamic'
// B2 (2026-11-27): explícito, no el defecto del plan. Las acciones de la cola corren en la función de esta
// página, y la reserva de un cambio vale 2 minutos (`reclamar_cambio_pendiente`, 20270209120000): 60 s
// de esta función, más 8 s del `statement_timeout` de `authenticated` (leído en producción), más margen.
// Si se sube este número, hay que subir la reserva en la base.
export const maxDuration = 60

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * F11-G-3 (decisión J) — cola de validación de la dirección. Lista las ediciones de datos
 * sensibles que los tutores han hecho sobre altas YA validadas (matrícula 'activa') y que
 * esperan aprobación. Los del centro activo: la RLS de `cambios_pendientes` deja ver los de
 * todos los centros donde el usuario es admin.
 */
export default async function PendientesPage({ params }: PageProps) {
  const { locale } = await params
  const { centroId } = await requireContextoCentro(locale)
  const t = await getTranslations('admin.pendientes')
  const items = await listarCambiosPendientes(centroId)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>
      <ColaCambiosPendientes items={items} />
    </div>
  )
}
