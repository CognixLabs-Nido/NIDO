import type { NinoPendiente, SeguimientoAula } from '../types'

/** Aula del centro (semilla mínima para el seguimiento). */
export interface AulaSeed {
  id: string
  nombre: string
}

/** Matrícula activa → niño en un aula concreta del curso. */
export interface MatriculaSeed {
  aula_id: string
  nino: NinoPendiente
}

/**
 * Deriva el progreso por aula de una campaña (función pura, sin BD).
 *
 * - `total` = niños con matrícula ACTIVA en el aula (las bajas ya vienen filtradas
 *   por la query; Q3: las altas a mitad cuentan, las bajas no).
 * - `publicados` = niños cuyo informe del período está **publicado**.
 * - `pendientes` = niños activos SIN informe publicado (borrador o sin iniciar) —
 *   son justo los que la dirección puede reclamar.
 *
 * El vínculo informe↔campaña es lógico (Q6): «publicado» se evalúa contra
 * `informes_evolucion`, no contra una copia. Un niño solo tiene un aula activa por
 * curso (UNIQUE en `matriculas`), así que cada niño cuenta en una sola aula.
 */
export function derivarSeguimiento(
  aulas: AulaSeed[],
  matriculas: MatriculaSeed[],
  ninosPublicados: ReadonlySet<string>
): SeguimientoAula[] {
  const porAula = new Map<string, NinoPendiente[]>()
  for (const m of matriculas) {
    const lista = porAula.get(m.aula_id) ?? []
    lista.push(m.nino)
    porAula.set(m.aula_id, lista)
  }

  return aulas
    .map((aula) => {
      const ninos = porAula.get(aula.id) ?? []
      const pendientes = ninos
        .filter((n) => !ninosPublicados.has(n.id))
        .sort((a, b) => `${a.nombre} ${a.apellidos}`.localeCompare(`${b.nombre} ${b.apellidos}`))
      return {
        aulaId: aula.id,
        aulaNombre: aula.nombre,
        total: ninos.length,
        publicados: ninos.length - pendientes.length,
        pendientes,
      }
    })
    .sort((a, b) => a.aulaNombre.localeCompare(b.aulaNombre))
}
