import { ChevronLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { getAulaById } from '@/features/aulas/queries/get-aulas'
import { getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { PaseDeListaServicioCliente } from '@/features/parte-servicio/components/PaseDeListaServicioCliente'
import { getParteServicioAula } from '@/features/parte-servicio/queries/get-parte-servicio-aula'

interface PageProps {
  params: Promise<{ id: string; locale: string }>
  searchParams: Promise<{ fecha?: string }>
}

export default async function TeacherAulaServicioPage({ params, searchParams }: PageProps) {
  const { id, locale } = await params
  const { fecha: fechaQuery } = await searchParams
  const t = await getTranslations('parte_servicio')

  const aula = await getAulaById(id)
  if (!aula) notFound()

  // El parte es control interno del centro: solo profe del aula o admin.
  const rol = await getRolEnCentro(aula.centro_id)
  if (rol !== 'profe' && rol !== 'admin') redirect(`/${locale}/forbidden`)

  const fecha = fechaQuery && /^\d{4}-\d{2}-\d{2}$/.test(fechaQuery) ? fechaQuery : hoyMadrid()
  const filas = await getParteServicioAula(id, fecha)

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/teacher/aula/${id}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeftIcon className="size-4" />
        {aula.nombre}
      </Link>
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>

      <PaseDeListaServicioCliente
        centroId={aula.centro_id}
        locale={locale}
        fecha={fecha}
        filas={filas}
      />
    </div>
  )
}
