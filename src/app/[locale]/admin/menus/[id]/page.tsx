import { ChevronLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'

import { PlantillaMenuEditor } from '@/features/menus/components/PlantillaMenuEditor'
import { getPlantillaById } from '@/features/menus/queries/get-plantilla-by-id'
import type { EstadoPlantillaMenu } from '@/features/menus/schemas/menu'

const estadoVariant: Record<EstadoPlantillaMenu, 'success' | 'info' | 'secondary'> = {
  publicada: 'success',
  borrador: 'info',
  archivada: 'secondary',
}

interface PageProps {
  params: Promise<{ id: string; locale: string }>
}

export default async function AdminMenuEditorPage({ params }: PageProps) {
  const { id, locale } = await params
  const t = await getTranslations('menus')

  const result = await getPlantillaById(id)
  if (!result) notFound()
  const { plantilla, dias } = result

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/admin/menus`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeftIcon className="size-4" />
        {t('title')}
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-h1 text-foreground">{plantilla.nombre}</h1>
          <p className="text-muted-foreground text-sm">{t('editor_intro')}</p>
        </div>
        <Badge variant={estadoVariant[plantilla.estado] ?? 'outline'}>
          {t(`estado.${plantilla.estado}`)}
        </Badge>
      </header>

      <PlantillaMenuEditor
        plantillaId={plantilla.id}
        readOnly={plantilla.estado === 'archivada'}
        diasIniciales={{
          lunes: dias.lunes ?? null,
          martes: dias.martes ?? null,
          miercoles: dias.miercoles ?? null,
          jueves: dias.jueves ?? null,
          viernes: dias.viernes ?? null,
        }}
      />
    </div>
  )
}
