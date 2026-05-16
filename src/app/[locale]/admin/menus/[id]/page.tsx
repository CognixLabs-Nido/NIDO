import { notFound, redirect } from 'next/navigation'

import { getCalendarioMes } from '@/features/calendario-centro/queries/get-calendario-mes'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { EditorMenuMensual } from '@/features/menus/components/EditorMenuMensual'
import { getPlantillaMes } from '@/features/menus/queries/get-plantilla-mes'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

export default async function AdminMenuEditorPage({ params }: PageProps) {
  const { locale, id } = await params

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'admin') redirect(`/${locale}/forbidden`)

  const plantillaConMenus = await getPlantillaMes(id)
  if (!plantillaConMenus) notFound()
  if (plantillaConMenus.plantilla.centro_id !== centroId) redirect(`/${locale}/forbidden`)

  const overridesCalendario = await getCalendarioMes(
    centroId,
    plantillaConMenus.plantilla.anio,
    plantillaConMenus.plantilla.mes
  )

  return (
    <EditorMenuMensual
      plantilla={plantillaConMenus.plantilla}
      menus={plantillaConMenus.menus}
      overridesCalendario={overridesCalendario}
      locale={locale as 'es' | 'en' | 'va'}
      backHref={`/${locale}/admin/menus`}
    />
  )
}
