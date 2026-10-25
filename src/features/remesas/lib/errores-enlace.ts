/**
 * Lo que dice la BD al enlazar recibos con una remesa (`recibos_remesa_validar`, `20261120120000`),
 * traducido a una clave de `messages`. Cualquier otro error, la clave por defecto de quien llama.
 */
const POR_HINT = {
  recibo_en_otra_remesa: 'remesas.errors.recibo_en_otra_remesa',
  recibo_no_remesable: 'remesas.errors.recibo_no_remesable',
  remesa_cerrada: 'remesas.errors.ya_enviada',
  remesa_con_fichero: 'remesas.errors.remesa_con_fichero',
} as const

export type HintEnlace = keyof typeof POR_HINT

export function claveErrorEnlace(
  error: { code?: string; hint?: string | null } | null,
  porDefecto: string
): string {
  if (error?.code === '42501') return 'remesas.errors.no_autorizado'
  const hint = error?.hint ?? ''
  return hint in POR_HINT ? POR_HINT[hint as HintEnlace] : porDefecto
}
