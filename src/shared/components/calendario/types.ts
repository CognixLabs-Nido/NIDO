import type { ReactNode } from 'react'

/**
 * Calendario mensual genérico — tipos compartidos.
 *
 * El componente es agnóstico de dominio: no conoce `dias_centro`, ni
 * eventos, ni nada. F4.5a (calendario laboral) y F7 (eventos) lo reúsan
 * pasando el render de cada celda vía `renderDia`.
 */

export type CalendarioLocale = 'es' | 'en' | 'va'

export interface CalendarioMensualProps {
  /** Mes a mostrar (1-12). Si llega fuera de rango se normaliza al renderizar. */
  mes: number
  /** Año (4 dígitos). */
  anio: number
  /** Cómo renderizar el contenido de cada celda. */
  renderDia: (fecha: Date, dentroDelMes: boolean) => ReactNode
  /** Handler de click simple sobre una celda. */
  onClickDia?: (fecha: Date) => void
  /** Handler de selección de rango (shift+click). */
  onSeleccionRango?: (desde: Date, hasta: Date) => void
  /** Día actualmente resaltado (focus/active). */
  diaActivo?: Date | null
  /**
   * Rango actualmente seleccionado (selección pendiente de confirmar).
   * Las celdas dentro del rango llevan estilo `ring` adicional y un
   * data-attribute para que el padre pueda decorarlas más si quiere.
   */
  rangoSeleccionado?: { desde: Date; hasta: Date } | null
  /** Handler de cambio de mes (← →). Si no se provee, navegación deshabilitada. */
  onCambioMes?: (mes: number, anio: number) => void
  /** aria-label para el grid (i18n por el padre). */
  ariaLabel?: string
  /** Locale para nombres de meses/días. Default 'es'. */
  locale?: CalendarioLocale
  /** Etiquetas i18n para los botones de navegación. */
  labels?: {
    anterior?: string
    siguiente?: string
  }
}
