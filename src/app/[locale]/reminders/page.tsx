import { redirect } from 'next/navigation'

import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { RecordatoriosView } from '@/features/recordatorios/components/RecordatoriosView'
import { destinosParaRol } from '@/features/recordatorios/lib/form-helpers'
import { getAulasParaRecordatorios } from '@/features/recordatorios/queries/get-aulas-para-recordatorios'
import { getNinosParaRecordatorios } from '@/features/recordatorios/queries/get-ninos-para-recordatorios'
import { getProfesParaRecordatorios } from '@/features/recordatorios/queries/get-profes-para-recordatorios'
import {
  getRecordatoriosCompletadosDeUsuario,
  getRecordatoriosPendientesDeUsuario,
} from '@/features/recordatorios/queries/get-recordatorios-usuario'
import { createClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ locale: string }>
}

type RolRecordatorios = 'admin' | 'profe' | 'tutor_legal' | 'autorizado'

export default async function RemindersPage({ params }: PageProps) {
  const { locale } = await params

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)

  const rolRaw = await getRolEnCentro(centroId)
  // F6-C: los 4 roles acceden a /reminders. admin/profe CREAN y reciben;
  // tutor_legal/autorizado SOLO reciben (sin botón crear → ver RecordatoriosView).
  if (
    !rolRaw ||
    (rolRaw !== 'admin' &&
      rolRaw !== 'profe' &&
      rolRaw !== 'tutor_legal' &&
      rolRaw !== 'autorizado')
  ) {
    redirect(`/${locale}/forbidden`)
  }
  const rol = rolRaw as RolRecordatorios

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) redirect(`/${locale}/login`)

  // El form (creación) es solo para staff. Los pickers (aulas/profes) solo se
  // cargan para quien puede usarlos.
  const esStaff = rol === 'admin' || rol === 'profe'

  const [pendientes, completados, ninos, aulas, profes] = await Promise.all([
    getRecordatoriosPendientesDeUsuario(),
    getRecordatoriosCompletadosDeUsuario(),
    esStaff ? getNinosParaRecordatorios() : Promise.resolve([]),
    esStaff ? getAulasParaRecordatorios(rol, centroId) : Promise.resolve([]),
    rol === 'admin' ? getProfesParaRecordatorios(centroId) : Promise.resolve([]),
  ])

  return (
    <RecordatoriosView
      locale={locale}
      userId={userId}
      destinos={destinosParaRol(rol)}
      ninos={ninos}
      aulas={aulas}
      profes={profes}
      pendientes={pendientes}
      completados={completados}
    />
  )
}
