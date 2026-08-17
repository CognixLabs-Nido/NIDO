import type { Database } from '@/types/database'

/**
 * Criterio ÚNICO de "quién es alumno" y "qué alta sigue en proceso".
 *
 * Existe porque las tres lecturas que dependen de esto —la pestaña Niños, su archivo y la
 * lista de Admisiones— son queries INDEPENDIENTES sobre tablas distintas (`ninos` y
 * `lista_espera`). Antes cada una decidía por su cuenta a quién mostrar, y ahí nacieron los
 * dos bugs: Niños enseñaba altas a medias como si fueran alumnos, y Admisiones seguía
 * enseñando a los ya matriculados. Con el criterio en un solo sitio no pueden volver a
 * separarse.
 *
 * Puro y sin dependencias de Supabase: se testea aislado.
 */

export type EstadoMatricula = Database['public']['Enums']['matricula_estado']

/** Lo mínimo que hay que leer de una matrícula para clasificar al niño. */
export interface SenalMatricula {
  estado: EstadoMatricula
  /** Sello de la primera activación. NULL = esta matrícula nunca llegó a activarse. */
  activada_at: string | null
}

/**
 * ¿Este niño FUE ALUMNO alguna vez? — matriculado ahora o en el pasado.
 *
 * La respuesta es el sello `activada_at`, no el estado actual: un ex-alumno tiene su
 * matrícula en `baja`, y por el estado sería indistinguible de un alta a medias que
 * dirección archivó. Esa ambigüedad es justo la que la columna vino a cerrar.
 */
export function fueAlumno(matriculas: readonly SenalMatricula[]): boolean {
  return matriculas.some((m) => m.activada_at !== null)
}

/**
 * ¿El alta de este niño sigue EN PROCESO? — es decir, ¿pinta algo en Admisiones?
 *
 * Se resuelve por ESTADO, no por el sello: lo que cierra el proceso de alta es que la
 * matrícula quede resuelta, y hay dos formas de resolverse —`activa` (se matriculó) y
 * `baja` (se cerró)—. En ambas Admisiones ya no tiene nada que hacer.
 *
 * Sin matrículas ⇒ TRUE: el prospecto no se ha promovido todavía (o se promovió y perdimos
 * el enlace), que es precisamente cuando hace falta verlo para invitar o completar.
 */
export function altaEnProceso(matriculas: readonly SenalMatricula[]): boolean {
  return !matriculas.some((m) => m.estado === 'activa' || m.estado === 'baja')
}
