'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { cancelarInvitacionDirectora } from '../actions/gestionar-direccion'

import { ConfirmarDireccionDialog } from './ConfirmarDireccionDialog'

export function CancelarInvitacionDirectora({
  centroId,
  invitacionId,
  email,
}: {
  centroId: string
  invitacionId: string
  email: string
}) {
  const t = useTranslations('admin.direccion.pendientes')
  const router = useRouter()
  return (
    <ConfirmarDireccionDialog
      cta={t('cancelar')}
      titulo={t('cancelar_title')}
      texto={t('cancelar_texto', { email })}
      confirmar={t('cancelar')}
      destructiva
      accion={() => cancelarInvitacionDirectora(centroId, invitacionId)}
      alTerminar={() => router.refresh()}
    />
  )
}
