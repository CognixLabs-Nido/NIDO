import { redirect } from 'next/navigation'

import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { RecordatoriosView } from '@/features/recordatorios/components/RecordatoriosView'
import { destinosParaRol } from '@/features/recordatorios/lib/form-helpers'
import { getNinosParaRecordatorios } from '@/features/recordatorios/queries/get-ninos-para-recordatorios'
import {
  getRecordatoriosCompletadosDeUsuario,
  getRecordatoriosPendientesDeUsuario,
} from '@/features/recordatorios/queries/get-recordatorios-usuario'
import { createClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function RemindersPage({ params }: PageProps) {
  const { locale } = await params

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
  const rol = rolRaw as 'admin' | 'profe' | 'tutor_legal' | 'autorizado'

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) redirect(`/${locale}/login`)

  const [pendientes, completados, ninos] = await Promise.all([
    getRecordatoriosPendientesDeUsuario(),
    getRecordatoriosCompletadosDeUsuario(),
    getNinosParaRecordatorios(),
  ])

  return (
    <RecordatoriosView
      locale={locale}
      userId={userId}
      destinos={destinosParaRol(rol)}
      ninos={ninos}
      pendientes={pendientes}
      completados={completados}
    />
  )
}
