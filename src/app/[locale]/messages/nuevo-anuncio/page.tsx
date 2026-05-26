import { redirect } from 'next/navigation'

import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { AnuncioComposer } from '@/features/messaging/components/AnuncioComposer'
import { getAulasParaAnuncio } from '@/features/messaging/queries/get-aulas-para-anuncio'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function NuevoAnuncioPage({ params }: PageProps) {
  const { locale } = await params

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)

  const rol = await getRolEnCentro(centroId)
  if (rol !== 'admin' && rol !== 'profe') redirect(`/${locale}/messages`)

  const aulas = await getAulasParaAnuncio(centroId)

  return <AnuncioComposer locale={locale} rolEsAdmin={rol === 'admin'} aulas={aulas} />
}
