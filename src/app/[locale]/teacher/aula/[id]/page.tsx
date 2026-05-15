import { ChevronLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { getAulaById } from '@/features/aulas/queries/get-aulas'
import { AgendaAulaCliente } from '@/features/agenda-diaria/components/AgendaAulaCliente'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { getAgendasAulaDelDia } from '@/features/agenda-diaria/queries/get-agendas-aula-del-dia'

interface PageProps {
  params: Promise<{ id: string; locale: string }>
  searchParams: Promise<{ fecha?: string }>
}

export default async function TeacherAulaPage({ params, searchParams }: PageProps) {
  const { id, locale } = await params
  const { fecha: fechaQuery } = await searchParams
  const t = await getTranslations('teacher.aula')
  const tNav = await getTranslations('teacher.nav')

  const aula = await getAulaById(id)
  if (!aula) notFound()

  // Default: hoy hora Madrid. Si llega ?fecha=YYYY-MM-DD válida, la usamos;
  // un valor inválido cae a hoy.
  const fecha = fechaQuery && /^\d{4}-\d{2}-\d{2}$/.test(fechaQuery) ? fechaQuery : hoyMadrid()

  const resumenes = await getAgendasAulaDelDia(id, fecha)

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/teacher`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeftIcon className="size-4" />
        {tNav('dashboard')}
      </Link>
      <header className="space-y-2">
        <h1 className="text-h1 text-foreground">{aula.nombre}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">{t('cohorte_label')}:</span>
          {aula.cohorte_anos_nacimiento.map((y) => (
            <Badge key={y} variant="warm">
              {y}
            </Badge>
          ))}
        </div>
      </header>

      <AgendaAulaCliente aulaId={id} locale={locale} fecha={fecha} resumenes={resumenes} />
    </div>
  )
}
