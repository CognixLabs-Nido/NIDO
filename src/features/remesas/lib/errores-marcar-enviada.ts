/**
 * Lo que dice la BD al marcar enviada una remesa (`marcar_remesa_enviada`, `20261221120000`),
 * traducido a una clave de `messages`. Cada clave dice qué ha pasado y qué hay que hacer:
 *  - `sin_fichero`: falta descargar el fichero (la remesa no tiene el de su versión guardado);
 *  - `fichero_no_coincide`: después de descargarlo cambió algún recibo de la remesa (se borró o
 *    cambió su importe); hay que reabrirla y descargar el fichero nuevo.
 * Cualquier otro error, `enviar_failed`.
 */
const POR_HINT = {
  sin_fichero: 'remesas.errors.sin_fichero',
  fichero_no_coincide: 'remesas.errors.fichero_no_coincide',
  ya_enviada: 'remesas.errors.ya_enviada',
  no_encontrada: 'remesas.errors.no_encontrada',
} as const

export type HintMarcarEnviada = keyof typeof POR_HINT

export function claveErrorMarcarEnviada(error: {
  code?: string
  hint?: string | null
}): string {
  if (error.code === '42501') return 'remesas.errors.no_autorizado'
  const hint = error.hint ?? ''
  return hint in POR_HINT ? POR_HINT[hint as HintMarcarEnviada] : 'remesas.errors.enviar_failed'
}

/** Todas las claves que puede devolver `claveErrorMarcarEnviada` (para el test de i18n). */
export const CLAVES_ERROR_MARCAR_ENVIADA: readonly string[] = [
  ...Object.values(POR_HINT),
  'remesas.errors.no_autorizado',
  'remesas.errors.enviar_failed',
]
