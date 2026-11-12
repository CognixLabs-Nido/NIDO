import { ChevronLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getAulaById } from '@/features/aulas/queries/get-aulas'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { PaseDeListaCliente } from '@/features/asistencia/components/PaseDeListaCliente'
import { getPaseDeListaAula } from '@/features/asistencia/queries/get-pase-de-lista-aula'
import { logger } from '@/shared/lib/logger'

interface PageProps {
  params: Promise<{ id: string; locale: string }>
  searchParams: Promise<{ fecha?: string }>
}

export default async function TeacherAulaAsistenciaPage({ params, searchParams }: PageProps) {
  const { id, locale } = await params
  const { fecha: fechaQuery } = await searchParams
  const t = await getTranslations('asistencia')

  const aula = await getAulaById(id)
  if (!aula) notFound()

  const fecha = fechaQuery && /^\d{4}-\d{2}-\d{2}$/.test(fechaQuery) ? fechaQuery : hoyMadrid()
  // Si no se pudo leer (las asistencias, las ausencias, las alertas o los niños), no se ofrece pasar
  // lista: sobre filas en blanco, guardar pisaría lo apuntado, y sin las ausencias se marcaría
  // presente a quien su familia avisó de que no viene (2026-11-12, medido). Se dice, y se reintenta.
  let filas: Awaited<ReturnType<typeof getPaseDeListaAula>> | null = null
  try {
    filas = await getPaseDeListaAula(id, fecha)
  } catch (e) {
    logger.warn(
      'asistencia: pase de lista sin leer',
      e instanceof Error ? e.message : 'desconocido'
    )
  }

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

      {filas ? (
        <PaseDeListaCliente aulaId={id} locale={locale} fecha={fecha} filas={filas} />
      ) : (
        <p className="text-destructive text-sm" role="alert" data-testid="pase-lista-no-leido">
          {t('no_leido')}
        </p>
      )}
    </div>
  )
}
