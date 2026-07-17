// Agrupado del desglose de un recibo FAMILIAR para el portal del tutor (F-4-6). Puro y
// sin dependencias (Supabase queda en la query): testeable como función. Reparte las
// líneas del recibo en un grupo por HIJO (línea con `ninoId`) más un bloque de líneas
// FAMILIARES (`ninoId` NULL: descuento hermanos, saldo arrastrado, cargo de familia),
// para que el tutor lea claro qué se cobra por cada hijo y qué es de la familia. Espejo
// del orden de `panel-familia` (F-4-4): hijos por nombre; dentro, positivas antes que
// negativas y desempate por descripción.

export interface LineaReciboFamilia {
  id: string
  descripcion: string
  cantidad: number
  precioUnitarioCentimos: number
  importeCentimos: number
}

/** Línea cruda del recibo con el hijo al que pertenece (NULL = línea familiar). */
export interface LineaConNino extends LineaReciboFamilia {
  ninoId: string | null
}

/** Un hijo con sus líneas y el subtotal (suma de importes de sus líneas). */
export interface GrupoHijoDetalle {
  ninoId: string
  ninoNombre: string
  lineas: LineaReciboFamilia[]
  subtotalCentimos: number
}

export interface DesgloseReciboFamilia {
  gruposHijo: GrupoHijoDetalle[]
  lineasFamiliares: LineaReciboFamilia[]
  /** Suma de importes de las líneas familiares (puede ser negativa). */
  subtotalFamiliarCentimos: number
}

/** Positivas antes que negativas; desempate por descripción (locale es-ES). */
function ordenarLineas(a: LineaReciboFamilia, b: LineaReciboFamilia): number {
  const signo = Number(b.importeCentimos > 0) - Number(a.importeCentimos > 0)
  if (signo !== 0) return signo
  return a.descripcion.localeCompare(b.descripcion, 'es-ES')
}

function despojar(l: LineaConNino): LineaReciboFamilia {
  return {
    id: l.id,
    descripcion: l.descripcion,
    cantidad: l.cantidad,
    precioUnitarioCentimos: l.precioUnitarioCentimos,
    importeCentimos: l.importeCentimos,
  }
}

/**
 * Reparte las líneas de un recibo familiar en grupos por hijo + bloque familiar.
 * Determinista: grupos ordenados por nombre de hijo (es-ES, desempate por ninoId);
 * líneas dentro de cada bloque por importe/descripción. `nombrePorNino` resuelve el
 * nombre visible de cada hijo (si falta, cae al ninoId para no romper la vista).
 */
export function agruparLineasPorHijo(
  lineas: LineaConNino[],
  nombrePorNino: Map<string, string>
): DesgloseReciboFamilia {
  const porHijo = new Map<string, LineaConNino[]>()
  const familiares: LineaConNino[] = []
  for (const l of lineas) {
    if (l.ninoId == null) {
      familiares.push(l)
    } else {
      const actual = porHijo.get(l.ninoId) ?? []
      actual.push(l)
      porHijo.set(l.ninoId, actual)
    }
  }

  const gruposHijo: GrupoHijoDetalle[] = [...porHijo.entries()]
    .map(([ninoId, ls]) => {
      const lineasHijo = ls.map(despojar).sort(ordenarLineas)
      return {
        ninoId,
        ninoNombre: nombrePorNino.get(ninoId) ?? ninoId,
        lineas: lineasHijo,
        subtotalCentimos: lineasHijo.reduce((acc, l) => acc + l.importeCentimos, 0),
      }
    })
    .sort(
      (a, b) =>
        a.ninoNombre.localeCompare(b.ninoNombre, 'es-ES') || a.ninoId.localeCompare(b.ninoId)
    )

  const lineasFamiliares = familiares.map(despojar).sort(ordenarLineas)

  return {
    gruposHijo,
    lineasFamiliares,
    subtotalFamiliarCentimos: lineasFamiliares.reduce((acc, l) => acc + l.importeCentimos, 0),
  }
}
