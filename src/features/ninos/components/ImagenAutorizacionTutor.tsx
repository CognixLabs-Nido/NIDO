'use client'

import { useTranslations } from 'next-intl'

import type { EstadoImagenNino } from '../queries/get-estado-imagen-nino'
import { AutorizarImagenNinoButton } from './AutorizarImagenNinoButton'
import { RevocarImagenNinoButton } from './RevocarImagenNinoButton'

interface Props {
  ninoId: string
  nombreCompleto: string
  estado: EstadoImagenNino
}

/** Clave del estado que ve el tutor. */
export function estadoImagenClave(
  estado: EstadoImagenNino
): 'concedida' | 'pendiente_otro' | 'no_autorizada' {
  if (estado.visible) return 'concedida'
  return estado.hayVigente ? 'pendiente_otro' : 'no_autorizada'
}

/**
 * Portal de familia — bloque «Autorización de imagen» de la ficha del niño (solo tutor
 * legal). Revocar si hay algún consentimiento vigente (cae el de todos los tutores, como
 * IU-4); autorizar si el tutor no tiene uno vigente.
 */
export function ImagenAutorizacionTutor({ ninoId, nombreCompleto, estado }: Props) {
  const t = useTranslations('family.nino.imagen')
  const clave = estadoImagenClave(estado)

  return (
    <div className="space-y-3" data-testid="imagen-autorizacion-tutor">
      <p className="text-sm" data-testid={`imagen-estado-${clave}`}>
        {t(`estado.${clave}`)}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        {!estado.miVigente && (
          <AutorizarImagenNinoButton ninoId={ninoId} nombreCompleto={nombreCompleto} />
        )}
        {estado.hayVigente && (
          <RevocarImagenNinoButton
            ninoId={ninoId}
            nombreCompleto={nombreCompleto}
            textos="family.nino.imagen.revocar"
          />
        )}
      </div>
    </div>
  )
}
