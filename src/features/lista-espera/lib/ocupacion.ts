import type { Database } from '@/types/database'

type MatriculaEstado = Database['public']['Enums']['matricula_estado']

export interface AulaConOcupacion {
  aulaId: string
  nombre: string
  capacidad: number
  ocupacion: number
}

/**
 * Estados de matrícula que OCUPAN plaza en un aula para el aviso de capacidad.
 *
 * Clave del "no doble conteo" (F11-H / PR-2): la plaza comprometida por una
 * invitación enviada y su matrícula pendiente son la MISMA fila de `matriculas`
 * (la invitación crea una matrícula `pendiente`). Por eso la ocupación se define
 * como el número de matrículas ACTIVAS o PENDIENTES del aula en el curso — cuenta
 * ambas categorías sin sumarlas dos veces. NO se suman invitaciones por separado.
 */
export const ESTADOS_QUE_OCUPAN: MatriculaEstado[] = ['activa', 'pendiente']

/**
 * Ocupación de un aula = nº de matrículas (activa o pendiente) que recibe. Recibe
 * las filas YA acotadas a un aula+curso (deleted_at/fecha_baja filtrados en la
 * query) y cuenta solo las que ocupan plaza. Filtra por estado defensivamente para
 * ser correcta aunque la query cambie.
 */
export function contarOcupacionAula(matriculas: { estado: MatriculaEstado }[]): number {
  return matriculas.filter((m) => ESTADOS_QUE_OCUPAN.includes(m.estado)).length
}

/**
 * ¿Añadir una matrícula más superaría la capacidad del aula? Es un AVISO (no un
 * bloqueo): la capacidad de `aulas_curso` es informativa. `ocupacion + 1 > capacidad`
 * ⟺ `ocupacion >= capacidad`.
 */
export function superaCapacidad(ocupacion: number, capacidad: number): boolean {
  return ocupacion + 1 > capacidad
}
