/**
 * Los códigos de lo que falta en una petición de olvido, los mismos que escribe
 * `privado.olvido_bloqueos` (`20261126120000`). Un test los compara con la migración y con las
 * traducciones: un código nuevo en la BD sin entrada aquí se pone rojo.
 */
export const CODIGOS_BLOQUEO = [
  'matricula_viva',
  'hijos_matriculados',
  'recibos_pendientes',
] as const

export const CODIGOS_AVISO = [
  'recibos_familia_pendientes',
  'cobro_banco_reciente',
  'dinero_a_favor',
  'mandato_activo',
] as const

export type CodigoFalta = (typeof CODIGOS_BLOQUEO)[number] | (typeof CODIGOS_AVISO)[number]

const CONOCIDOS = new Set<string>([...CODIGOS_BLOQUEO, ...CODIGOS_AVISO])

export function esCodigoFalta(codigo: string): codigo is CodigoFalta {
  return CONOCIDOS.has(codigo)
}
