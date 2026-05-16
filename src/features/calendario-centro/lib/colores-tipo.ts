import type { TipoDiaCentro } from '../schemas/dia-centro'

/**
 * Mapa de tipo → clases Tailwind para celda y chip de leyenda.
 *
 * Los colores siguen el design system (ADR-0008):
 *  - lectivo: neutro (default abierto).
 *  - festivo: coral (destacado, atención).
 *  - vacaciones: azul info (frío, planificado).
 *  - escuela_verano: warm/amarillo (calor, especial).
 *  - escuela_navidad: azul primary (servicio especial).
 *  - jornada_reducida: warm suave (matiz sobre abierto).
 *  - cerrado: gris (default cerrado, neutral).
 *
 * Cada par incluye `cell` (background+borde para la celda del grid) y
 * `chip` (fondo+borde+texto para la leyenda y badges).
 */
export const COLORES_TIPO: Record<TipoDiaCentro, { cell: string; chip: string }> = {
  lectivo: {
    cell: 'bg-neutral-50 border-neutral-200',
    chip: 'bg-neutral-100 border-neutral-300 text-neutral-700',
  },
  festivo: {
    cell: 'bg-coral-100 border-coral-300',
    chip: 'bg-coral-100 border-coral-300 text-coral-700',
  },
  vacaciones: {
    cell: 'bg-info-100 border-info-300',
    chip: 'bg-info-100 border-info-300 text-info-700',
  },
  escuela_verano: {
    cell: 'bg-accent-warm-100 border-accent-warm-300',
    chip: 'bg-accent-warm-100 border-accent-warm-300 text-accent-warm-800',
  },
  escuela_navidad: {
    cell: 'bg-primary-100 border-primary-300',
    chip: 'bg-primary-100 border-primary-300 text-primary-700',
  },
  jornada_reducida: {
    cell: 'bg-accent-warm-50 border-accent-warm-200',
    chip: 'bg-accent-warm-50 border-accent-warm-200 text-accent-warm-700',
  },
  cerrado: {
    cell: 'bg-muted border-border',
    chip: 'bg-muted border-border text-muted-foreground',
  },
}

export const TIPOS_ORDEN: readonly TipoDiaCentro[] = [
  'lectivo',
  'festivo',
  'vacaciones',
  'escuela_verano',
  'escuela_navidad',
  'jornada_reducida',
  'cerrado',
] as const
