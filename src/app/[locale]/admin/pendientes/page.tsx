import { getTranslations } from 'next-intl/server'

import { ColaCambiosPendientes } from '@/features/cambios-pendientes/components/ColaCambiosPendientes'
import { listarCambiosPendientes } from '@/features/cambios-pendientes/queries/get-cola'

export const dynamic = 'force-dynamic'

/**
 * F11-G-3 (decisión J) — cola de validación de la dirección. Lista las ediciones de datos
 * sensibles que los tutores han hecho sobre altas YA validadas (matrícula 'activa') y que
 * esperan aprobación. La RLS de `cambios_pendientes` limita a los del centro del admin.
 */
export default async function PendientesPage() {
  const t = await getTranslations('admin.pendientes')
  const items = await listarCambiosPendientes()

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
