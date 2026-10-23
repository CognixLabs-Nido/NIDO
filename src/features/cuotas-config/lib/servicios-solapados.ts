import type { Database } from '@/types/database'

type TipoConcepto = Database['public']['Enums']['tipo_concepto']
export type Servicio = Database['public']['Enums']['servicio_diario']

/** Concepto activo del centro que lleva servicio (un diario, o un mensual «de comedor»). */
export interface ConceptoConServicio {
  id: string
  tipo_concepto: TipoConcepto
  servicio: Servicio
}

const ORDEN: Servicio[] = ['comedor', 'matinera', 'vespertina']

/**
 * PR-4: servicios de los que el niño tiene asignados a la vez un concepto MENSUAL y uno DIARIO.
 * El motor cobra solo el mensual: no cobra los días de ese servicio a quien tiene la cuota. Esto
 * es el aviso para que la directora vea que hay un diario que sobra.
 *
 * `asignados` son los ids de TODOS los conceptos asignados al niño, también los automáticos, que
 * no salen en el diálogo de asignación pero el motor cobra igual.
 */
export function serviciosSolapados(
  asignados: Iterable<string>,
  conceptosConServicio: ConceptoConServicio[]
): Servicio[] {
  const ids = new Set(asignados)
  const mensual = new Set<Servicio>()
  const diario = new Set<Servicio>()
  for (const c of conceptosConServicio) {
    if (!ids.has(c.id)) continue
    if (c.tipo_concepto === 'mensual') mensual.add(c.servicio)
    else if (c.tipo_concepto === 'diario') diario.add(c.servicio)
  }
  return ORDEN.filter((s) => mensual.has(s) && diario.has(s))
}

/** «comedor y matinera»: los servicios en minúscula, unidos como lista del idioma. */
export function listaServicios(
  servicios: Servicio[],
  etiqueta: (s: Servicio) => string,
  locale: string
): string {
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(
    servicios.map((s) => etiqueta(s).toLocaleLowerCase(locale))
  )
}
