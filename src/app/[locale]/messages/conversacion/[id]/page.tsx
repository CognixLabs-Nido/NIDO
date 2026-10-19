import { notFound, redirect } from 'next/navigation'

import { ConfirmarCentroDelAviso } from '@/features/centros/components/ConfirmarCentroDelAviso'
import { centroDelAvisoPorConfirmar } from '@/features/centros/contexto/centro-del-aviso'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { ConversacionAdminFamiliaView } from '@/features/messaging/components/ConversacionAdminFamiliaView'
import { ConversacionView } from '@/features/messaging/components/ConversacionView'
import { getAdminFamiliaDetalle } from '@/features/messaging/queries/get-admin-familia-detalle'
import { getConversacionDetalle } from '@/features/messaging/queries/get-conversacion-detalle'
import { createClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
  searchParams: Promise<{ centro?: string }>
}

export default async function ConversacionPage({ params, searchParams }: PageProps) {
  const { locale, id } = await params
  const { centro } = await searchParams

  const contexto = await requireContextoCentro(locale)
  const { centroId, rol: rolRaw } = contexto
  // La notificación de otro centro del usuario: primero se confirma el cambio (antes de buscar
  // la conversación, que en este centro daría «no encontrado»).
  const centroDelAviso = centroDelAvisoPorConfirmar(contexto, centro)
  if (centroDelAviso) {
    return (
      <ConfirmarCentroDelAviso
        locale={locale}
        centroDelAvisoId={centroDelAviso}
        centroActivoId={centroId}
        returnTo={`/${locale}/messages/conversacion/${id}`}
      />
    )
  }
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
  // Multicentro: las dos consultas de detalle solo devuelven la conversación del centro activo;
  // la de otro centro (un enlace o una notificación de allí) también acaba en notFound().
  const supabase = await createClient()
  const { data: tipoRow } = await supabase
    .from('conversaciones')
    .select('tipo_conversacion')
    .eq('id', id)
    .maybeSingle()

  if (!tipoRow) notFound()

  if (tipoRow.tipo_conversacion === 'admin_familia') {
    const detalle = await getAdminFamiliaDetalle(id, centroId)
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
  const detalle = await getConversacionDetalle(id, centroId)
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
