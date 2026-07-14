import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']

/** Nombre del mes (1-12) localizado y capitalizado, p. ej. "Julio". */
export function nombreMes(mes: number, locale: string): string {
  const label = new Intl.DateTimeFormat(locale, { month: 'long' }).format(
    new Date(2000, mes - 1, 1)
  )
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** Período legible "Julio 2026". */
export function formatPeriodo(anio: number, mes: number, locale: string): string {
  return `${nombreMes(mes, locale)} ${anio}`
}

/** Variante de Badge por estado del recibo (coherente con el panel de gestión admin). */
export const ESTADO_BADGE_VARIANT: Record<EstadoRecibo, 'secondary' | 'warm' | 'outline'> = {
  borrador: 'outline', // F-4-1: recibo generado por el motor, pendiente de confirmar
  pendiente_procesar: 'secondary',
  enviado_banco: 'outline',
  devuelto: 'warm',
  cobrado_manual: 'secondary',
}
