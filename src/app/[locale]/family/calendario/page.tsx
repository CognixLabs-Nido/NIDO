import { CalendarDaysIcon } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { CalendarioCentroReadOnly } from '@/features/calendario-centro/components/CalendarioCentroReadOnly'
import { LeyendaTiposDia } from '@/features/calendario-centro/components/LeyendaTiposDia'
import { getCalendarioMes } from '@/features/calendario-centro/queries/get-calendario-mes'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ anio?: string; mes?: string }>
}

function hoyMadrid(): { anio: number; mes: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
  })
  const parts = fmt.formatToParts(new Date())
  return {
    anio: Number(parts.find((p) => p.type === 'year')!.value),
    mes: Number(parts.find((p) => p.type === 'month')!.value),
  }
}

export default async function FamilyCalendarioPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const { anio: anioQ, mes: mesQ } = await searchParams
  const t = await getTranslations('calendario')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'tutor_legal' && rol !== 'autorizado' && rol !== 'admin') {
    redirect(`/${locale}/forbidden`)
  }

  const hoy = hoyMadrid()
  const anioNum = anioQ && /^\d{4}$/.test(anioQ) ? Number(anioQ) : hoy.anio
  const mesNum =
    mesQ && /^\d{1,2}$/.test(mesQ) && Number(mesQ) >= 1 && Number(mesQ) <= 12
      ? Number(mesQ)
      : hoy.mes

  const overrides = await getCalendarioMes(centroId, anioNum, mesNum)

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-h1 text-foreground flex items-center gap-2">
          <CalendarDaysIcon className="text-primary-600 size-7" />
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('vista_solo_lectura')}</p>
      </header>

      <CalendarioCentroReadOnly
        mesInicial={mesNum}
        anioInicial={anioNum}
        overrides={overrides}
        locale={locale as 'es' | 'en' | 'va'}
      />

      <LeyendaTiposDia />
    </div>
  )
}
