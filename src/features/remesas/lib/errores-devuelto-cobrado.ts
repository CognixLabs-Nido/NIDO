/**
 * Lo que dice la BD al marcar un recibo devuelto (`marcar_recibo_devuelto`) o cobrado a mano
 * (`marcar_cobrado_manual`), `20261223120000`, traducido a una clave de `messages`. Hasta esa
 * migración la app hacía estos rechazos ella misma antes de un UPDATE directo; ahora los hace la
 * función, cada uno con su HINT, y aquí solo se traducen. Son las mismas claves que antes.
 */
const DEVUELTO = {
  fecha_devolucion_invalida: 'remesas.validation.fecha_devolucion_futura',
  devolucion_antes_del_envio: 'remesas.validation.devolucion_antes_del_envio',
  gastos_invalidos: 'remesas.validation.gastos_invalidos',
  no_devolvible: 'remesas.errors.no_devolvible',
  no_encontrado: 'remesas.errors.no_encontrada',
  datos_no_validos: 'remesas.errors.invalid',
} as const

const COBRADO = {
  fecha_cobro_futura: 'remesas.validation.fecha_cobro_futura',
  nota_cobro_larga: 'remesas.validation.nota_cobro_larga',
  sepa_por_remesa: 'remesas.errors.sepa_por_remesa',
  devolucion_por_resolver: 'remesas.errors.devolucion_por_resolver',
  no_cobrable_manual: 'remesas.errors.no_cobrable_manual',
  no_encontrado: 'remesas.errors.no_encontrada',
  forma_no_valida: 'remesas.errors.invalid',
  datos_no_validos: 'remesas.errors.invalid',
} as const

function traducir(
  mapa: Record<string, string>,
  error: { code?: string; hint?: string | null },
  porDefecto: string
): string {
  if (error.code === '42501') return 'remesas.errors.no_autorizado'
  const hint = error.hint ?? ''
  return Object.hasOwn(mapa, hint) ? mapa[hint]! : porDefecto
}

export function claveErrorDevuelto(error: { code?: string; hint?: string | null }): string {
  return traducir(DEVUELTO, error, 'remesas.errors.devolver_failed')
}

export function claveErrorCobrado(error: { code?: string; hint?: string | null }): string {
  return traducir(COBRADO, error, 'remesas.errors.cobrar_manual_failed')
}

/** Los HINT de cada función (para el test que los compara con la migración). */
export const HINTS_DEVUELTO: readonly string[] = Object.keys(DEVUELTO)
export const HINTS_COBRADO: readonly string[] = Object.keys(COBRADO)

/** Todas las claves que pueden devolver (para el test de i18n). */
export const CLAVES_ERROR_DEVUELTO_COBRADO: readonly string[] = [
  ...new Set([
    ...Object.values(DEVUELTO),
    ...Object.values(COBRADO),
    'remesas.errors.no_autorizado',
    'remesas.errors.devolver_failed',
    'remesas.errors.cobrar_manual_failed',
  ]),
]
