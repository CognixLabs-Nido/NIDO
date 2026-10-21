import { getTranslations } from 'next-intl/server'

import { ColaCambiosPendientes } from '@/features/cambios-pendientes/components/ColaCambiosPendientes'
import { listarCambiosPendientes } from '@/features/cambios-pendientes/queries/get-cola'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'

export const dynamic = 'force-dynamic'

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
