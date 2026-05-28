import { notFound, redirect } from 'next/navigation'

import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { ConversacionAdminFamiliaView } from '@/features/messaging/components/ConversacionAdminFamiliaView'
import { ConversacionView } from '@/features/messaging/components/ConversacionView'
import { getAdminFamiliaDetalle } from '@/features/messaging/queries/get-admin-familia-detalle'
import { getConversacionDetalle } from '@/features/messaging/queries/get-conversacion-detalle'
import { createClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

export default async function ConversacionPage({ params }: PageProps) {
  const { locale, id } = await params

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

  // Dispatch por `tipo_conversacion`: la query F5 hace INNER JOIN con ninos
  // y devolvería null para admin_familia (nino_id NULL). Determinamos el
  // tipo primero con un SELECT mínimo que respeta la RLS de SELECT — si
  // el caller no es participante, no ve la fila y devolvemos notFound().
  const supabase = await createClient()
  const { data: tipoRow } = await supabase
    .from('conversaciones')
    .select('tipo_conversacion')
    .eq('id', id)
    .maybeSingle()

  if (!tipoRow) notFound()

  if (tipoRow.tipo_conversacion === 'admin_familia') {
    const detalle = await getAdminFamiliaDetalle(id)
    if (!detalle) notFound()
    return (
      <ConversacionAdminFamiliaView
        locale={locale}
        rolEnHilo={detalle.rolEnHilo}
        header={detalle.header}
        mensajes={detalle.mensajes}
      />
    )
  }

  // Rama F5 profe_familia — sin cambios funcionales.
  const detalle = await getConversacionDetalle(id)
  if (!detalle) notFound()

  return (
    <ConversacionView
      locale={locale}
      rol={rol}
      header={detalle.header}
      mensajes={detalle.mensajes}
      participo={detalle.participo}
    />
  )
}
