import { ChevronLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getAulaById } from '@/features/aulas/queries/get-aulas'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { momentoComidaEnum } from '@/features/agenda-diaria/schemas/agenda-diaria'
import type { MomentoComida } from '@/features/agenda-diaria/schemas/agenda-diaria'
import { PaseDeListaComidaCliente } from '@/features/menus/components/PaseDeListaComidaCliente'
import { getPaseDeListaComida } from '@/features/menus/queries/get-pase-de-lista-comida'

interface PageProps {
  params: Promise<{ id: string; locale: string }>
  searchParams: Promise<{ fecha?: string; momento?: string }>
}

function parseMomento(raw: string | undefined): MomentoComida {
  const r = momentoComidaEnum.safeParse(raw)
  return r.success ? r.data : 'comida'
}

export default async function TeacherAulaComidaPage({ params, searchParams }: PageProps) {
  const { id, locale } = await params
  const { fecha: fechaQuery, momento: momentoQuery } = await searchParams
  const t = await getTranslations('comida_batch')

  const aula = await getAulaById(id)
  if (!aula) notFound()

  const fecha = fechaQuery && /^\d{4}-\d{2}-\d{2}$/.test(fechaQuery) ? fechaQuery : hoyMadrid()
  const momento = parseMomento(momentoQuery)
  const payload = await getPaseDeListaComida(id, fecha, momento)

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

      <PaseDeListaComidaCliente aulaId={id} locale={locale} payload={payload} />
    </div>
  )
}
