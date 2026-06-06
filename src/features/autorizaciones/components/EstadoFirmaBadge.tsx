'use client'

import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'

import type { AutorizacionEstado, EstadoFirmaNino, TipoAutorizacion } from '../types'

const FIRMA_VARIANT: Record<
  EstadoFirmaNino,
  'success' | 'warning' | 'destructive' | 'info' | 'outline'
> = {
  firmado: 'success',
  pendiente: 'warning',
  parcial: 'info',
  rechazado: 'destructive',
  revocado: 'outline',
}

const DOC_VARIANT: Record<AutorizacionEstado, 'info' | 'success' | 'outline'> = {
  borrador: 'outline',
  publicada: 'success',
  anulada: 'info',
}

/** Badge del estado de firma de un niño (roster / lista familia). */
export function EstadoFirmaBadge({ estado }: { estado: EstadoFirmaNino }) {
  const t = useTranslations('autorizaciones')
  return <Badge variant={FIRMA_VARIANT[estado]}>{t(`estado_firma.${estado}`)}</Badge>
}

/** Badge del estado del documento (borrador/publicada/anulada). */
export function EstadoDocBadge({ estado }: { estado: AutorizacionEstado }) {
  const t = useTranslations('autorizaciones')
  return <Badge variant={DOC_VARIANT[estado]}>{t(`estado_doc.${estado}`)}</Badge>
}

/** Etiqueta del tipo de autorización (salida, reglas de régimen interno, …). */
export function TipoAutorizacionBadge({ tipo }: { tipo: TipoAutorizacion }) {
  const t = useTranslations('autorizaciones')
  return <Badge variant="secondary">{t(`tipo.${tipo}`)}</Badge>
}
