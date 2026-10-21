'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { ConfirmarDireccionDialog } from '@/features/direccion/components/ConfirmarDireccionDialog'

import { darDeBajaTemporal, darSalidaDelCentro, reactivarPersonal } from '../actions/baja-personal'

/** Lo que Dirección hace con una persona del personal activo: baja temporal o salida del centro. */
export function AccionesPersonal({
  centroId,
  usuarioId,
  nombre,
}: {
  centroId: string
  usuarioId: string
  nombre: string
}) {
  const t = useTranslations('admin.personal')
  const router = useRouter()
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <ConfirmarDireccionDialog
        cta={t('baja_temporal.cta')}
        titulo={t('baja_temporal.title', { nombre })}
        texto={t('baja_temporal.texto', { nombre })}
        confirmar={t('baja_temporal.confirmar')}
        accion={() => darDeBajaTemporal(centroId, usuarioId)}
        alTerminar={() => router.refresh()}
      />
      <ConfirmarDireccionDialog
        cta={t('salida.cta')}
        titulo={t('salida.title', { nombre })}
        texto={t('salida.texto', { nombre })}
        confirmar={t('salida.confirmar')}
        destructiva
        accion={() => darSalidaDelCentro(centroId, usuarioId)}
        alTerminar={() => router.refresh()}
      />
    </div>
  )
}

/** Quien vuelve de una baja temporal: Dirección la reactiva, sin invitación. */
export function ReactivarPersonal({
  centroId,
  usuarioId,
  nombre,
}: {
  centroId: string
  usuarioId: string
  nombre: string
}) {
  const t = useTranslations('admin.personal')
  const router = useRouter()
  return (
    <ConfirmarDireccionDialog
      cta={t('reactivar.cta')}
      titulo={t('reactivar.title', { nombre })}
      texto={t('reactivar.texto', { nombre })}
      confirmar={t('reactivar.confirmar')}
      accion={() => reactivarPersonal(centroId, usuarioId)}
      alTerminar={() => router.refresh()}
    />
  )
}
