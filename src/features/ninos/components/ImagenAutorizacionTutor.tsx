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
 * Clave del estado que ve el tutor. `denegada_por_mi`: ha dicho que no (10a-2). `oposicion`: ha dicho
 * que sí y otro se ha opuesto (10b-2); `oposicion_sin_respuesta`: no ha contestado y otro se ha
 * opuesto (10b-3). `pendiente_otro`: hay un «sí» y nadie se opone, pero falta el «sí» de otro tutor.
 */
export function estadoImagenClave(
  estado: EstadoImagenNino
):
  | 'concedida'
  | 'denegada_por_mi'
  | 'oposicion'
  | 'oposicion_sin_respuesta'
  | 'pendiente_otro'
  | 'no_autorizada' {
  if (estado.visible) return 'concedida'
  if (estado.miNo) return 'denegada_por_mi'
  // «Cada tutor legal ve que el otro se ha opuesto» (2026-11-18), sin decir quién. Con mi «sí» se
  // deducía de `existe_consentimiento_imagen` (10b-2); al que no ha contestado se lo dice la base
  // (`oposicion_imagen`, 10b-3), porque para él false era también «nadie ha dicho que sí».
  if (estado.hayOposicion) return estado.miVigente ? 'oposicion' : 'oposicion_sin_respuesta'
  // Hay un «sí» que vale y aun así no sale: falta el «sí» de otro tutor (los dos firmantes).
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
