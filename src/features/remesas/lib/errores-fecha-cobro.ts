/**
 * Lo que dice la BD al poner la fecha (`recibos_fecha_cobro_proteger`, `fijar_fecha_cobro_recibos`),
 * traducido a una clave de `messages`. Cada «no» dice por qué.
 */
const POR_HINT = {
  fecha_cobro_en_fichero: 'remesas.errors.fecha_cobro_en_fichero',
  fecha_cobro_recibo_cerrado: 'remesas.errors.fecha_cobro_recibo_cerrado',
  recibo_no_sepa: 'remesas.errors.fecha_cobro_no_sepa',
} as const

export function claveErrorFechaCobro(
  error: { code?: string; hint?: string | null } | null
): string {
  if (error?.code === '42501') return 'remesas.errors.no_autorizado'
  if (error?.code === '22023') return 'remesas.errors.invalid'
  const hint = error?.hint ?? ''
  return hint in POR_HINT
    ? POR_HINT[hint as keyof typeof POR_HINT]
    : 'remesas.errors.fecha_cobro_failed'
}
