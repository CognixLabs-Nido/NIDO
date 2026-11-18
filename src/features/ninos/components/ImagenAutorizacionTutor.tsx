'use client'

import { useTranslations } from 'next-intl'

import type { EstadoImagenNino } from '../queries/get-estado-imagen-nino'
import { AutorizarImagenNinoButton } from './AutorizarImagenNinoButton'
import { DenegarImagenNinoButton } from './DenegarImagenNinoButton'
import { RetirarNoImagenNinoButton } from './RetirarNoImagenNinoButton'
import { RevocarImagenNinoButton } from './RevocarImagenNinoButton'

interface Props {
  ninoId: string
  nombreCompleto: string
  estado: EstadoImagenNino
}

/**
 * Clave del estado que ve el tutor. `denegada_por_mi`: ha dicho que no (10a-2). `pendiente_otro`:
 * hay un «sí» (el suyo u otro) y el niño no aparece, porque falta el otro tutor o porque el otro ha
 * dicho que no; desde aquí no se sabe cuál.
 */
export function estadoImagenClave(
  estado: EstadoImagenNino
): 'concedida' | 'denegada_por_mi' | 'pendiente_otro' | 'no_autorizada' {
  if (estado.visible) return 'concedida'
  if (estado.miNo) return 'denegada_por_mi'
  return estado.hayVigente || estado.miVigente ? 'pendiente_otro' : 'no_autorizada'
}

/**
 * Portal de familia — bloque «Autorización de imagen» de la ficha del niño (solo tutor legal). Cada
 * tutor responde por sí (decisión del responsable del 2026-11-17): autorizar si no ha dicho que sí;
 * decir que no si no lo ha dicho; retirar su «no» si lo tiene; y revocar si hay algún «sí» (cae el de
 * todos los tutores, como IU-4, y deja los «no»).
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
        {!estado.miNo && (
          <DenegarImagenNinoButton ninoId={ninoId} nombreCompleto={nombreCompleto} />
        )}
        {estado.miNo && (
          <RetirarNoImagenNinoButton ninoId={ninoId} nombreCompleto={nombreCompleto} />
        )}
        {(estado.hayVigente || estado.miVigente) && (
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
