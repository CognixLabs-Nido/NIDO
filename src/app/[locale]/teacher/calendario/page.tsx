import { CalendarDaysIcon } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { LeyendaTiposDia } from '@/features/calendario-centro/components/LeyendaTiposDia'
import { getCalendarioMes } from '@/features/calendario-centro/queries/get-calendario-mes'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { CalendarioConEventos } from '@/features/eventos/components/CalendarioConEventos'
import { EventoFormDialog } from '@/features/eventos/components/EventoFormDialog'
import { getEventosMes } from '@/features/eventos/queries/get-eventos-mes'
import { getAulasParaRecordatorios } from '@/features/recordatorios/queries/get-aulas-para-recordatorios'
import { getNinosParaRecordatorios } from '@/features/recordatorios/queries/get-ninos-para-recordatorios'
import type { AmbitoEvento } from '@/features/eventos/types'

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

export default async function TeacherCalendarioPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const { anio: anioQ, mes: mesQ } = await searchParams
  const t = await getTranslations('calendario')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'profe' && rol !== 'admin') redirect(`/${locale}/forbidden`)

  const hoy = hoyMadrid()
  const anioNum = anioQ && /^\d{4}$/.test(anioQ) ? Number(anioQ) : hoy.anio
  const mesNum =
    mesQ && /^\d{1,2}$/.test(mesQ) && Number(mesQ) >= 1 && Number(mesQ) <= 12
      ? Number(mesQ)
      : hoy.mes

  const esAdmin = rol === 'admin'
  const [overrides, eventos, aulas, ninos] = await Promise.all([
    getCalendarioMes(centroId, anioNum, mesNum),
    getEventosMes(centroId, anioNum, mesNum),
    getAulasParaRecordatorios(esAdmin ? 'admin' : 'profe', centroId),
    esAdmin ? getNinosParaRecordatorios() : Promise.resolve([]),
  ])
  const ambitos: AmbitoEvento[] = esAdmin ? ['centro', 'aula', 'nino'] : ['aula']

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-2">
        <div className="space-y-2">
          <h1 className="text-h1 text-foreground flex items-center gap-2">
            <CalendarDaysIcon className="text-primary-600 size-7" />
            {t('title')}
          </h1>
          <p className="text-muted-foreground text-sm">{t('vista_solo_lectura')}</p>
        </div>
        <EventoFormDialog locale={locale} ambitos={ambitos} aulas={aulas} ninos={ninos} />
      </header>

      <CalendarioConEventos
        mesInicial={mesNum}
        anioInicial={anioNum}
        overrides={overrides}
        eventos={eventos}
        locale={locale as 'es' | 'en' | 'va'}
        esAdmin={esAdmin}
        esFamilia={false}
        centroId={centroId}
      />

      <LeyendaTiposDia />
    </div>
  )
}
