'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { darDeBajaDirectora, traspasarAdmin } from '../actions/gestionar-direccion'

import { ConfirmarDireccionDialog } from './ConfirmarDireccionDialog'

/** Lo que la admin hace con una directora: traspasarle la administración o darla de baja. */
export function AccionesDirectora({
  centroId,
  usuarioId,
  nombre,
  puedeTraspasar,
}: {
  centroId: string
  usuarioId: string
  nombre: string
  /** Solo quien tiene la fila de admin traspasa (el superusuario, no). */
  puedeTraspasar: boolean
}) {
  const t = useTranslations('admin.direccion')
  const router = useRouter()
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {puedeTraspasar && (
        <ConfirmarDireccionDialog
          cta={t('traspasar.cta')}
          titulo={t('traspasar.title', { nombre })}
          texto={t('traspasar.texto', { nombre })}
          confirmar={t('traspasar.confirmar')}
          accion={() => traspasarAdmin(centroId, usuarioId)}
          alTerminar={() => router.refresh()}
        />
      )}
      <ConfirmarDireccionDialog
        cta={t('baja.cta')}
        titulo={t('baja.title', { nombre })}
        texto={t('baja.texto', { nombre })}
        confirmar={t('baja.confirmar')}
        destructiva
        accion={() => darDeBajaDirectora(centroId, usuarioId)}
        alTerminar={() => router.refresh()}
      />
    </div>
  )
}
