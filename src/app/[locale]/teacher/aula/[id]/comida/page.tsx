import { ChevronLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { getAulaById } from '@/features/aulas/queries/get-aulas'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { PaseDeListaComidaCliente } from '@/features/menus/components/PaseDeListaComidaCliente'
import { getPaseDeListaComida } from '@/features/menus/queries/get-pase-de-lista-comida'
import type { MomentoComida } from '@/features/menus/types'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
  searchParams: Promise<{ fecha?: string; momento?: string }>
}

const MOMENTOS_VALIDOS: MomentoComida[] = ['desayuno', 'media_manana', 'comida', 'merienda']

export default async function TeacherComidaPage({ params, searchParams }: PageProps) {
  const { locale, id } = await params
  const { fecha: fechaQ, momento: momentoQ } = await searchParams
  const tNav = await getTranslations('teacher.nav')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'profe' && rol !== 'admin') redirect(`/${locale}/forbidden`)

  const aula = await getAulaById(id)
  if (!aula) notFound()

  const fecha = fechaQ && /^\d{4}-\d{2}-\d{2}$/.test(fechaQ) ? fechaQ : hoyMadrid()
  const momento: MomentoComida =
    momentoQ && (MOMENTOS_VALIDOS as string[]).includes(momentoQ)
      ? (momentoQ as MomentoComida)
      : 'comida'

  const state = await getPaseDeListaComida(id, fecha, momento)

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/teacher/aula/${id}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeftIcon className="size-4" />
        {tNav('dashboard')}
      </Link>
      <PaseDeListaComidaCliente
        aulaId={id}
        fecha={fecha}
        momento={momento}
        state={state}
        locale={locale}
      />
    </div>
  )
}
