import type { TipoDiaCentro } from '../schemas/dia-centro'

import { tipoDefaultDeFecha } from './tipo-default'

/**
 * Helpers para resolver tipos de cada celda del grid mensual a partir
 * de un mapa de overrides cargados desde `dias_centro`.
 */

/** YYYY-MM-DD para una `Date` sin convertir a UTC. */
export function isoYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Mapa `fecha YYYY-MM-DD → { tipo, observaciones }` para resolver el tipo
 * de cada celda sin hacer una query extra por día.
 */
export type OverrideMap = ReadonlyMap<string, { tipo: TipoDiaCentro; observaciones: string | null }>

/** Devuelve el tipo resuelto para `fecha` consultando overrides + default. */
export function tipoResuelto(fecha: Date, overrides: OverrideMap): TipoDiaCentro {
  const override = overrides.get(isoYmd(fecha))
  return override ? override.tipo : tipoDefaultDeFecha(fecha)
}

/** ¿Está la fecha incluida en el rango `[desde, hasta]` ambos inclusive? */
export function dentroDeRango(fecha: Date, desde: Date, hasta: Date): boolean {
  const f = fecha.getTime()
  const d = desde.getTime()
  const h = hasta.getTime()
  const min = d < h ? d : h
  const max = d < h ? h : d
  return f >= min && f <= max
}
