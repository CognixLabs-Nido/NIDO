import { ChevronLeftIcon, ImageOffIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Card } from '@/components/ui/card'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { FotoPendienteCard } from '@/features/fotos/components/FotoPendienteCard'
import { getFotosPendientesNino } from '@/features/fotos/queries/get-fotos-pendientes-nino'
import { EmptyState } from '@/shared/components/EmptyState'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ locale: string; ninoId: string }>
}

/**
 * IU-5 — detalle de un niño revocado: sus fotos pendientes de resolver. Cada una con
 * vista + acciones (marcar resuelta / borrar publicación). Cuando no quedan pendientes,
 * se muestra el estado vacío (el niño ya no está en el listado general).
 */
export default async function FotosRevocadasNinoPage({ params }: PageProps) {
  const { locale, ninoId } = await params
  const t = await getTranslations('admin.fotosRevocadas')
  const centroId = (await getCentroActualId())!
  const detalle = await getFotosPendientesNino(ninoId, centroId)
  if (!detalle) notFound()

  const nombreCompleto = `${detalle.nombre} ${detalle.apellidos ?? ''}`.trim()

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          href={`/${locale}/admin/fotos-revocadas`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeftIcon className="size-4" />
          {t('volver')}
        </Link>
        <h1 className="text-h1 text-foreground">
          {t('detalle_titulo', { nombre: nombreCompleto })}
        </h1>
        <p className="text-muted-foreground text-sm">{t('detalle_descripcion')}</p>
      </header>

      {detalle.fotos.length === 0 ? (
        <Card>
          <EmptyState icon={<ImageOffIcon />} title={t('detalle_vacio')} />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {detalle.fotos.map((foto) => (
            <FotoPendienteCard key={foto.etiquetaId} foto={foto} />
          ))}
        </div>
      )}
    </div>
  )
}
