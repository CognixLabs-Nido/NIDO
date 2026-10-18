import { redirect } from 'next/navigation'

import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { AnuncioComposer } from '@/features/messaging/components/AnuncioComposer'
import { getAulasParaAnuncio } from '@/features/messaging/queries/get-aulas-para-anuncio'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function NuevoAnuncioPage({ params }: PageProps) {
  const { locale } = await params

  const { centroId, rol } = await requireContextoCentro(locale)
  if (rol !== 'admin' && rol !== 'profe') redirect(`/${locale}/messages`)

  const aulas = await getAulasParaAnuncio(centroId)

  return <AnuncioComposer locale={locale} rolEsAdmin={rol === 'admin'} aulas={aulas} />
}
