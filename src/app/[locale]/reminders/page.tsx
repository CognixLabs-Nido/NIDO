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
  // Recordatorios es solo admin/profe en el MVP (hotfix #44). El guard del
  // layout ya redirige tutor/autorizado; se repite aquí por defensa en
  // profundidad ante acceso directo a la ruta de la page.
  if (rolRaw === 'tutor_legal' || rolRaw === 'autorizado') {
    redirect(`/${locale}/family`)
  }
  if (!rolRaw || (rolRaw !== 'admin' && rolRaw !== 'profe')) {
    redirect(`/${locale}/forbidden`)
  }
  const rol = rolRaw as 'admin' | 'profe'

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
