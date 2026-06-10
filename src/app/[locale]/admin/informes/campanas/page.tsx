import { ArrowLeftIcon, CalendarRangeIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { CampanaEstadoButton } from '@/features/informes/components/CampanaEstadoButton'
import { CampanaInformeDialog } from '@/features/informes/components/CampanaInformeDialog'
import { SeguimientoCampana } from '@/features/informes/components/SeguimientoCampana'
import { getCampanasInformeCursoActivo } from '@/features/informes/queries/get-campanas-informe'
import { getSeguimientoCampana } from '@/features/informes/queries/get-seguimiento-campana'
import type { PeriodoInforme } from '@/features/informes/types'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ periodo?: string }>
}

export default async function AdminCampanasPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const periodoParam = (await searchParams).periodo
  const t = await getTranslations('informes')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'admin') redirect(`/${locale}/forbidden`)

  const data = await getCampanasInformeCursoActivo(centroId)

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link
          href={`/${locale}/admin/informes`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-4" />
          {t('volver')}
        </Link>
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-2">
            <h1 className="text-h1 text-foreground flex items-center gap-2">
              <CalendarRangeIcon className="text-primary-600 size-7" />
              {t('campana.title')}
            </h1>
            <p className="text-muted-foreground text-sm">{t('campana.admin_intro')}</p>
          </div>
          {data && <CampanaInformeDialog periodosOcupados={data.campanas.map((c) => c.periodo)} />}
        </header>
      </div>

      {!data ? (
        <p className="text-muted-foreground text-sm">{t('campana.sin_curso_activo')}</p>
      ) : (
        <CampanasContenido data={data} locale={locale} periodoParam={periodoParam} />
      )}
    </div>
  )
}

async function CampanasContenido({
  data,
  locale,
  periodoParam,
}: {
  data: NonNullable<Awaited<ReturnType<typeof getCampanasInformeCursoActivo>>>
  locale: string
  periodoParam?: string
}) {
  const t = await getTranslations('informes')
  const { cursoId, cursoNombre, campanas } = data

  // Período seleccionado para el seguimiento: el de la query si es válido; si no,
  // la primera campaña abierta; si no hay abiertas, la primera de la lista.
  const valido = campanas.find((c) => c.periodo === periodoParam)
  const seleccionada = valido ?? campanas.find((c) => c.estado === 'abierta') ?? campanas[0]
  const seguimiento = seleccionada
    ? await getSeguimientoCampana(cursoId, seleccionada.periodo as PeriodoInforme)
    : []

  return (
    <>
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-h2 text-foreground">{t('campana.lista_titulo')}</h2>
          <p className="text-muted-foreground text-sm">
            {t('campana.curso_activo', { curso: cursoNombre })}
          </p>
        </div>

        {campanas.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('campana.sin_campanas')}</p>
        ) : (
          <ul className="divide-border divide-y rounded-lg border">
            {campanas.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{t(`periodos.${c.periodo}`)}</span>
                    <Badge variant={c.estado === 'abierta' ? 'success' : 'secondary'}>
                      {t(`campana.estado.${c.estado}`)}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t('campana.fecha_limite_valor', { fecha: c.fecha_limite })}
                  </span>
                </span>
                <span className="flex flex-wrap gap-2">
                  {c.estado === 'abierta' && <CampanaInformeDialog campana={c} />}
                  <CampanaEstadoButton campanaId={c.id} estado={c.estado} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {campanas.length > 0 && (
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-h2 text-foreground">{t('campana.seguimiento.titulo')}</h2>
            <p className="text-muted-foreground text-sm">{t('campana.seguimiento.descripcion')}</p>
          </div>

          {/* Selector de período (links; server-side via searchParams). */}
          <nav className="flex flex-wrap gap-2" aria-label={t('campana.seguimiento.periodo_nav')}>
            {campanas.map((c) => {
              const activo = seleccionada?.id === c.id
              return (
                <Link
                  key={c.id}
                  href={`/${locale}/admin/informes/campanas?periodo=${c.periodo}`}
                  aria-current={activo ? 'page' : undefined}
                  className={
                    activo
                      ? 'bg-primary-600 rounded-md px-3 py-1 text-sm font-medium text-white'
                      : 'border-border text-muted-foreground hover:text-foreground rounded-md border px-3 py-1 text-sm'
                  }
                >
                  {t(`periodos.${c.periodo}`)}
                </Link>
              )
            })}
          </nav>

          <SeguimientoCampana seguimiento={seguimiento} />
        </section>
      )}
    </>
  )
}
