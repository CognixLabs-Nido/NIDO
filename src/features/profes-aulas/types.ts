/**
 * Tipos del dominio "personal de aula" (F5B-#34).
 *
 * El ENUM `tipo_personal_aula` reemplaza al booleano `es_profe_principal`
 * en `profes_aulas`. Sus 4 valores cubren el espectro completo:
 *
 *   - coordinadora: la profe responsable del aula (única por aula
 *     activa, garantizada por índice único parcial en BD).
 *   - profesora:    profe regular del aula.
 *   - tecnico:      técnico/a de educación infantil.
 *   - apoyo:        personal de refuerzo o apoyo puntual.
 *
 * El orden de declaración en la migración (coordinadora primero) define
 * el orden lexicográfico del enum en Postgres. `TIPO_PERSONAL_AULA_ORDER`
 * lo replica en TS para ordenar listas en la UI con coordinadora arriba.
 */
export const TIPO_PERSONAL_AULA = ['coordinadora', 'profesora', 'tecnico', 'apoyo'] as const

export type TipoPersonalAula = (typeof TIPO_PERSONAL_AULA)[number]

export const TIPO_PERSONAL_AULA_ORDER: Record<TipoPersonalAula, number> = {
  coordinadora: 0,
  profesora: 1,
  tecnico: 2,
  apoyo: 3,
}
