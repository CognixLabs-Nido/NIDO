import { redirect } from 'next/navigation'

import { AgendaView } from '@/features/agenda/components/AgendaView'
import { rangoDeVista, ymd } from '@/features/agenda/lib/fechas'
import { getCitasRango } from '@/features/agenda/queries/get-citas-rango'
import { getPreferenciaVistaAgenda } from '@/features/agenda/queries/get-preferencia-vista'
import type { VistaAgenda } from '@/features/agenda/types'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { getAulasParaRecordatorios } from '@/features/recordatorios/queries/get-aulas-para-recordatorios'
import { getNinosParaRecordatorios } from '@/features/recordatorios/queries/get-ninos-para-recordatorios'
import { getProfesParaRecordatorios } from '@/features/recordatorios/queries/get-profes-para-recordatorios'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ vista?: string; fecha?: string }>
}

type Rol = 'admin' | 'profe' | 'tutor_legal' | 'autorizado'

function esVista(v: string | undefined): v is VistaAgenda {
  return v === 'dia' || v === 'semana' || v === 'mes'
}

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/

export default async function AgendaPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const sp = await searchParams

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)

  const rolRaw = await getRolEnCentro(centroId)
  if (
    !rolRaw ||
    (rolRaw !== 'admin' &&
      rolRaw !== 'profe' &&
      rolRaw !== 'tutor_legal' &&
      rolRaw !== 'autorizado')
  ) {
    redirect(`/${locale}/forbidden`)
  }
  const rol = rolRaw as Rol
  const esStaff = rol === 'admin' || rol === 'profe'

  const vista: VistaAgenda = esVista(sp.vista) ? sp.vista : await getPreferenciaVistaAgenda()
  const fecha = sp.fecha && FORMATO_FECHA.test(sp.fecha) ? sp.fecha : ymd(new Date())

  const { desde, hasta } = rangoDeVista(vista, fecha)

  const [citas, ninos, aulas, profes] = await Promise.all([
    getCitasRango(desde, hasta),
    esStaff ? getNinosParaRecordatorios() : Promise.resolve([]),
    esStaff ? getAulasParaRecordatorios(rol, centroId) : Promise.resolve([]),
    rol === 'admin' ? getProfesParaRecordatorios(centroId) : Promise.resolve([]),
  ])

  return (
    <AgendaView
      locale={locale}
      rol={rol}
      vista={vista}
      fecha={fecha}
      citas={citas}
      ninos={ninos}
      aulas={aulas}
      profes={profes}
    />
  )
}
