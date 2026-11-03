/**
 * Lo que dice la BD al reabrir una remesa o al leer su aviso (`reabrir_remesa` y
 * `resumen_reabrir_remesa`, `20261227120000`), traducido a una clave de `messages`:
 *  - `nada_que_reabrir`: un borrador cuyo fichero no se generó nunca; ya se pueden quitar y añadir
 *    recibos sin reabrir;
 *  - `remesa_cambiada`: entre el aviso y el confirmar cambió el número de recibos o el importe; la
 *    persona no ha visto lo que se reabriría, así que hay que volver a abrir el aviso;
 *  - 42501: no es la admin del centro (ni la directora ni el superusuario reabren), o no hay sesión.
 * Cualquier otro error, `reabrir_failed`.
 */
const POR_HINT = {
  nada_que_reabrir: 'remesas.errors.nada_que_reabrir',
  remesa_cambiada: 'remesas.errors.remesa_cambiada',
  no_encontrada: 'remesas.errors.no_encontrada',
} as const

export type HintReabrir = keyof typeof POR_HINT

export function claveErrorReabrir(error: { code?: string; hint?: string | null }): string {
  if (error.code === '42501') return 'remesas.errors.no_autorizado'
  const hint = error.hint ?? ''
  return hint in POR_HINT ? POR_HINT[hint as HintReabrir] : 'remesas.errors.reabrir_failed'
}

/**
 * Del aviso, además: no se pudo leer (`aviso_failed`), o los devueltos y cobrados leídos no son
 * tantos como cuenta el resumen (`aviso_incompleto`). En los dos, el aviso no se enseña: sin él, la
 * admin confirmaría sin ver a quién no se toca.
 */
export const CLAVE_AVISO_FAILED = 'remesas.errors.aviso_failed'
export const CLAVE_AVISO_INCOMPLETO = 'remesas.errors.aviso_incompleto'

/** Todas las claves que pueden llegar al reabrir o al leer el aviso (para el test de i18n). */
export const CLAVES_ERROR_REABRIR: readonly string[] = [
  ...Object.values(POR_HINT),
  'remesas.errors.no_autorizado',
  'remesas.errors.reabrir_failed',
  'remesas.errors.invalid',
  CLAVE_AVISO_FAILED,
  CLAVE_AVISO_INCOMPLETO,
]
