/**
 * Definición ÚNICA de "matrícula activa/operativa" para el lado app, alineada con
 * los helpers RLS (`es_profe_de_nino`, `es_tutor_en_aula`, `familia_ve_aula`,
 * `usuario_es_audiencia_anuncio[_row]`, etc.):
 *
 *     fecha_baja IS NULL AND deleted_at IS NULL AND estado = 'activa'
 *
 * Una matrícula `'pendiente'` (esqueleto de niño, alta tutor-driven) tiene
 * `fecha_baja IS NULL` → sin el criterio `estado='activa'` colaría como activa en
 * las lecturas operativas (agenda, pase de lista, audiencias, etc.). Este módulo
 * centraliza el predicado para que app y RLS no diverjan.
 */

/** Estado de matrícula que cuenta como operativa. */
export const MATRICULA_ESTADO_ACTIVA = 'activa' as const

/**
 * Aplica el criterio de matrícula activa a un builder PostgREST sobre
 * `matriculas`. Encadenable: `aplicarMatriculaActiva(supabase.from('matriculas').select(...).eq(...))`.
 */
export function aplicarMatriculaActiva<
  T extends {
    is(column: 'fecha_baja' | 'deleted_at', value: null): T
    eq(column: 'estado', value: typeof MATRICULA_ESTADO_ACTIVA): T
  },
>(qb: T): T {
  return qb.is('fecha_baja', null).is('deleted_at', null).eq('estado', MATRICULA_ESTADO_ACTIVA)
}

/**
 * Predicado JS equivalente para matrículas embebidas (cuando el filtro no puede
 * ir en el builder, p. ej. recursos anidados `ninos(matriculas(...))`).
 */
export function esMatriculaActiva(m: {
  fecha_baja: string | null
  deleted_at: string | null
  estado: string | null
}): boolean {
  return m.fecha_baja === null && m.deleted_at === null && m.estado === MATRICULA_ESTADO_ACTIVA
}
