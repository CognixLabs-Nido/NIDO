'use client'

import { useLocale, useTranslations } from 'next-intl'

import { formatFechaCobro } from '../lib/fecha-cobro'

/** Cuándo se cobra un recibo: «El 5 nov 2026», o «En cuanto el banco pueda» si no tiene fecha. */
export function FechaCobroEtiqueta({ fecha }: { fecha: string | null }) {
  const t = useTranslations('remesas.fecha_cobro')
  const locale = useLocale()
  return <>{fecha ? t('el', { fecha: formatFechaCobro(fecha, locale) }) : t('sin_fecha')}</>
}
