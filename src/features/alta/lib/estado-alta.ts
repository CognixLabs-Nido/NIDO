/**
 * F11-G — modelo del wizard de alta del tutor, ahora de **7 pasos** con documentos. Cada
 * paso persiste por su cuenta (guardable y reanudable). El paso `cuenta` (creación de la
 * cuenta del tutor 1) vive en `/invitation/[token]` (pre-login); del paso 2 en adelante el
 * MISMO wizard corre en `/alta/[ninoId]` ya autenticado (arquitectura A). Por eso en `/alta`
 * el paso `cuenta` queda inalcanzable (clamp `PASO_MIN_AUTENTICADO`).
 *
 * El SEPA (decisión: G-2) NO está aquí: el stepper muestra estos 7 pasos.
 */
export const PASOS_ALTA = [
  'cuenta',
  'acuses',
  'menor',
  'tutor1',
  'tutor2',
  'medico',
  'emergencia',
] as const

export type PasoAlta = (typeof PASOS_ALTA)[number]

/** En `/alta` (post-login) el primer paso navegable es `acuses` (cuenta ya está hecha). */
export const PASO_MIN_AUTENTICADO = PASOS_ALTA.indexOf('acuses')

/** Señales de completitud derivadas de lo persistido (las lee la ruta server-side). */
export interface EstadoAlta {
  /** Identidad escrita: apellidos + fecha_nacimiento (lo único OBLIGATORIO). */
  identidadCompleta: boolean
  /** Consentimiento `datos_medicos` vigente (revocado_en IS NULL). */
  consintioDatosMedicos: boolean
}

/**
 * Índice (0-based sobre `PASOS_ALTA`) en el que reanudar dentro de `/alta` (post-login):
 *  - sin identidad → `acuses` (arranque del flujo tras crear la cuenta),
 *  - identidad hecha pero sin acuse médico → `medico` (lo único que falta para cerrar),
 *  - todo lo obligatorio hecho → `emergencia` (último paso, revisable).
 * Los pasos `tutor1`/`tutor2`/documentos no tienen señal dura (opcionales o de
 * persistencia propia), así que nunca atascan la reanudación.
 */
export function pasoInicialAlta(estado: EstadoAlta): number {
  if (!estado.identidadCompleta) return PASOS_ALTA.indexOf('acuses')
  if (!estado.consintioDatosMedicos) return PASOS_ALTA.indexOf('medico')
  return PASOS_ALTA.indexOf('emergencia')
}
