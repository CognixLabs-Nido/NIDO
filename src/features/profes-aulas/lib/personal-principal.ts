import type { TipoPersonalAula } from '../types'

/**
 * Quién es la persona PRINCIPAL de un aula (la que ve destacada la familia y la
 * dirección). Modelo de personal: la titular del aula es la `profesora`; la
 * `coordinadora` coordina un grupo de aulas y solo hace de principal cuando el aula no
 * tiene profesora. `tecnico` y `apoyo` nunca son principal.
 *
 *   1. Profesora. Si hay varias (bajas, refuerzos: norma blanda, la BD no lo impide),
 *      la que lleva más tiempo en el aula (`fecha_inicio` más antigua); empate →
 *      alfabético por nombre. Así un refuerzo que llega después no desplaza a la titular.
 *   2. Si no hay profesora, la coordinadora con el mismo orden.
 *   3. Si no hay ninguna de las dos, nadie.
 */
export interface PersonaAula {
  tipo_personal_aula: TipoPersonalAula
  /** `YYYY-MM-DD`: el orden lexicográfico es el cronológico. */
  fecha_inicio: string
  nombre_completo: string
}

/** Orden de presentación: profesora, coordinadora, técnico/a, apoyo. */
export const ORDEN_PRESENTACION: Record<TipoPersonalAula, number> = {
  profesora: 0,
  coordinadora: 1,
  tecnico: 2,
  apoyo: 3,
}

const PRIORIDAD_PRINCIPAL: TipoPersonalAula[] = ['profesora', 'coordinadora']

function masAntiguaPrimero(a: PersonaAula, b: PersonaAula): number {
  if (a.fecha_inicio !== b.fecha_inicio) return a.fecha_inicio < b.fecha_inicio ? -1 : 1
  return a.nombre_completo.localeCompare(b.nombre_completo)
}

/** La persona principal del aula, o `null` si no hay profesora ni coordinadora. */
export function elegirPrincipal<T extends PersonaAula>(personas: readonly T[]): T | null {
  for (const tipo of PRIORIDAD_PRINCIPAL) {
    const candidatas = personas.filter((p) => p.tipo_personal_aula === tipo)
    if (candidatas.length > 0) return [...candidatas].sort(masAntiguaPrimero)[0] ?? null
  }
  return null
}

/**
 * El personal del aula ordenado para mostrarlo: la principal primero; después el resto
 * por tipo (profesora, coordinadora, técnico/a, apoyo) y, dentro de cada tipo,
 * alfabético. `principal` es la misma referencia que devuelve `elegirPrincipal`.
 */
export function ordenarConPrincipal<T extends PersonaAula>(
  personas: readonly T[],
  principal: T | null
): T[] {
  return [...personas].sort((a, b) => {
    if (a === principal) return -1
    if (b === principal) return 1
    const porTipo =
      ORDEN_PRESENTACION[a.tipo_personal_aula] - ORDEN_PRESENTACION[b.tipo_personal_aula]
    if (porTipo !== 0) return porTipo
    return a.nombre_completo.localeCompare(b.nombre_completo)
  })
}
