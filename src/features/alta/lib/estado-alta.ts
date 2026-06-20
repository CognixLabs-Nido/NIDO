/**
 * Pieza 3b — modelo del wizard de alta del tutor. El alta completa una matrícula en
 * 5 pasos, guardable y reanudable: cada paso persiste por su cuenta (no hay un submit
 * final único), así que al volver se reanuda donde se dejó.
 *
 * Orden de los pasos. `consentimientos` (acuse de confidencialidad de datos médicos,
 * F11-F) precede a `medico`; el acuse es obligatorio para cerrar el alta, aunque la
 * ficha médica en sí sea voluntaria y ya no dependa de él.
 */
export const PASOS_ALTA = [
  'identidad',
  'pedagogicos',
  'consentimientos',
  'medico',
  'imagen',
] as const

export type PasoAlta = (typeof PASOS_ALTA)[number]

/** Señales de completitud derivadas de lo persistido (las lee la ruta server-side). */
export interface EstadoAlta {
  /** Identidad escrita: apellidos + fecha_nacimiento (lo único OBLIGATORIO). */
  identidadCompleta: boolean
  /** Existe fila en `datos_pedagogicos_nino`. */
  pedagogicosCompletos: boolean
  /** Consentimiento `datos_medicos` vigente (revocado_en IS NULL). */
  consintioDatosMedicos: boolean
}

/**
 * Índice (0-based sobre `PASOS_ALTA`) del paso en el que reanudar: el primer paso
 * no completado en orden. `medico` e `imagen` NO tienen señal de completitud —el
 * médico es OPCIONAL (art. 7.4) y la imagen se cubre al firmar—, así que la
 * reanudación nunca queda "atascada" en un opcional: si los tres primeros están
 * hechos, aterriza en `medico` (revisitable). El único gate duro es `identidad`.
 */
export function pasoInicialAlta(estado: EstadoAlta): number {
  if (!estado.identidadCompleta) return PASOS_ALTA.indexOf('identidad')
  if (!estado.pedagogicosCompletos) return PASOS_ALTA.indexOf('pedagogicos')
  if (!estado.consintioDatosMedicos) return PASOS_ALTA.indexOf('consentimientos')
  return PASOS_ALTA.indexOf('medico')
}
