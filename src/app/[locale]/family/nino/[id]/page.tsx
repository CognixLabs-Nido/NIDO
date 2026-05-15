import { BookOpenIcon, CalendarDaysIcon, ChevronLeftIcon, HeartIcon, InfoIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { getInfoMedica, getNinoById } from '@/features/ninos/queries/get-ninos'
import { DatosPedagogicosReadOnly } from '@/features/datos-pedagogicos/components/DatosPedagogicosReadOnly'
import { getDatosPedagogicos } from '@/features/datos-pedagogicos/queries/get-datos-pedagogicos'
import { AgendaFamiliaSinPermiso } from '@/features/agenda-diaria/components/AgendaFamiliaSinPermiso'
import { AgendaFamiliaView } from '@/features/agenda-diaria/components/AgendaFamiliaView'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { getAgendaDelDia } from '@/features/agenda-diaria/queries/get-agenda-del-dia'

interface PageProps {
  params: Promise<{ id: string; locale: string }>
  searchParams: Promise<{ fecha?: string }>
}

export default async function FamilyNinoPage({ params, searchParams }: PageProps) {
  const { id, locale } = await params
  const { fecha: fechaQuery } = await searchParams
  const t = await getTranslations('family.nino')
  const tNav = await getTranslations('family.nav')
  const tTabs = await getTranslations('family.nino.tabs')
  const nino = await getNinoById(id)
  if (!nino) notFound()

  // Default: hoy hora Madrid. Si llega ?fecha=YYYY-MM-DD válida, la usamos.
  const fecha = fechaQuery && /^\d{4}-\d{2}-\d{2}$/.test(fechaQuery) ? fechaQuery : hoyMadrid()

  let infoMedica = null
  try {
    infoMedica = await getInfoMedica(id)
  } catch {
    infoMedica = null
  }

  const datosPed = await getDatosPedagogicos(id)

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id

  let permisos: Record<string, boolean> = {}
  if (userId) {
    const { data: vinculo } = await supabase
      .from('vinculos_familiares')
      .select('permisos')
      .eq('usuario_id', userId)
      .eq('nino_id', id)
      .is('deleted_at', null)
      .maybeSingle()
    permisos = (vinculo?.permisos as Record<string, boolean> | null) ?? {}
  }

  // Agenda del día: cargamos siempre la estructura (RLS filtra si no hay
  // permiso); el render decide qué mostrar.
  const agendaDelDia = permisos.puede_ver_agenda ? await getAgendaDelDia(id, fecha) : null

  const initials = (nino.nombre.charAt(0) + (nino.apellidos.charAt(0) || '')).toUpperCase() || '?'

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/family`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeftIcon className="size-4" />
        {tNav('dashboard')}
      </Link>

      <header className="bg-card border-border/60 flex flex-wrap items-center gap-4 rounded-2xl border p-5 shadow-md">
        <div className="bg-primary-100 text-primary-700 flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-h2 text-foreground truncate">
            {nino.nombre} {nino.apellidos}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t('fecha_nacimiento')}: {nino.fecha_nacimiento}
          </p>
        </div>
      </header>

      <section className="space-y-4">
        <h2 className="text-h3 text-foreground flex items-center gap-2">
          <InfoIcon className="size-5" />
          {t('basicos')}
        </h2>
        <Card>
          <CardContent className="space-y-2 text-sm">
            <Row k={t('fecha_nacimiento')} v={nino.fecha_nacimiento} />
            <Row k={t('idioma_principal')} v={nino.idioma_principal} />
            <Row k={t('nacionalidad')} v={nino.nacionalidad ?? '—'} />
          </CardContent>
        </Card>
      </section>

      {permisos.puede_ver_datos_pedagogicos && datosPed && (
        <section className="space-y-4">
          <h2 className="text-h3 text-foreground flex items-center gap-2">
            <BookOpenIcon className="text-accent-warm-600 size-5" />
            {t('pedagogico')}
          </h2>
          <DatosPedagogicosReadOnly data={datosPed} />
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-h3 text-foreground flex items-center gap-2">
          <CalendarDaysIcon className="text-primary-600 size-5" />
          {tTabs('agenda')}
        </h2>
        {permisos.puede_ver_agenda && agendaDelDia ? (
          <AgendaFamiliaView ninoId={id} locale={locale} fecha={fecha} agenda={agendaDelDia} />
        ) : (
          <AgendaFamiliaSinPermiso />
        )}
      </section>

      {permisos.puede_ver_info_medica && infoMedica && (
        <section className="space-y-4">
          <h2 className="text-h3 text-foreground flex items-center gap-2">
            <HeartIcon className="text-coral-500 size-5" />
            {t('info_medica')}
          </h2>
          <Card>
            <CardContent className="space-y-2 text-sm">
              <Row k={t('alergias_graves')} v={infoMedica.alergias_graves ?? '—'} />
              <Row k={t('notas_emergencia')} v={infoMedica.notas_emergencia ?? '—'} />
              <Row k={t('medicacion_habitual')} v={infoMedica.medicacion_habitual ?? '—'} />
              <Row k={t('telefono_emergencia')} v={infoMedica.telefono_emergencia ?? '—'} />
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-dashed border-neutral-200 pb-2 last:border-b-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="text-muted-foreground w-40 shrink-0 text-xs font-medium tracking-wide uppercase">
        {k}
      </span>
      <span className="text-foreground break-words">{v}</span>
    </div>
  )
}
