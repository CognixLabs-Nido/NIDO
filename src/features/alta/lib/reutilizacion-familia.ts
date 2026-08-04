/**
 * Alta unificada · U-3 — reparto REUTILIZAR (de la familia) vs PEDIR (por el niño nuevo).
 *
 * Cuando el niño que se da de alta es el 2.º (o 3.º…) de una familia cuyo tutor YA existe,
 * el wizard no debe presentar en blanco lo que la familia ya tiene. El reparto (decisión
 * cerrada con el responsable):
 *
 *   REUTILIZAR de la familia   → identidad y dirección del tutor, DNI del tutor, mandato SEPA.
 *   PEDIR por el niño nuevo    → identidad del menor, salud/acuse médico, consentimiento de
 *                                IMAGEN y acuse de NORMAS (los cuatro son por-niño).
 *
 * Esta pieza es PURA (sin BD, sin React): decide, a partir de señales que la ruta lee del
 * servidor, qué pasos se presentan como YA RESUELTOS. La UI los muestra en solo lectura y
 * confirmables —nunca bloqueados—: el tutor puede abrirlos y corregir (una mudanza, un DNI
 * caducado) sin que se le exija rellenarlos otra vez.
 *
 * NO relaja el gate de completitud: `finalizarAlta` sigue exigiendo los mismos bloques. Lo
 * que ocurre es que los de familia ya están satisfechos por los datos compartidos (tutor 1 y
 * su DNI viven en `familia_tutores`; el mandato SEPA cuelga de `familias`), y los por-niño
 * siguen faltando hasta que el tutor los complete para este hijo.
 */

export interface SenalesFamiliaAlta {
  /** El tutor ya tiene OTRO hijo vinculado (hermano) → no es un alta de familia nueva. */
  tieneHermanos: boolean
  /** El perfil compartido `familia_tutores` del titular ya tiene `nombre_completo`. */
  tutor1ConNombre: boolean
  /** El titular ya tiene su DNI subido (`familia_tutores.dni_documento_path`). */
  tutor1ConDni: boolean
  /** La FAMILIA del niño ya tiene un mandato SEPA activo (F-2c-1). */
  mandatoFamiliaActivo: boolean
}

export interface ReutilizacionFamilia {
  /** Los pasos de tutor 1 y tutor 2 se presentan como ya resueltos (confirmables). */
  tutor: boolean
  /** El paso SEPA se presenta informativo (ya lo hacía F-2c-2; aquí solo se refleja). */
  sepa: boolean
  /** ¿Hay algo reutilizado? → la cabecera del wizard explica qué toca rellenar por el niño. */
  hayReutilizacion: boolean
}

/**
 * `tutor` exige las TRES señales: que haya hermano (si no, es la primera alta de la familia y
 * hay que pedirlo todo) y que el perfil compartido esté REALMENTE completo —nombre **y** DNI—.
 * Un perfil a medias (p. ej. una familia creada por Dirección con solo el nombre) NO se
 * presenta como resuelto: se pediría lo que falta, que es justo lo que el gate exigirá.
 *
 * `sepa` NO depende de `tieneHermanos`: el mandato es de la familia desde F-2c-1 y el paso 8
 * ya era informativo con mandato activo, incluso en un reintento del primer hijo. Se expone
 * aquí solo para que la cabecera sepa contarlo.
 */
export function resolverReutilizacionFamilia(s: SenalesFamiliaAlta): ReutilizacionFamilia {
  const tutor = s.tieneHermanos && s.tutor1ConNombre && s.tutor1ConDni
  const sepa = s.mandatoFamiliaActivo
  return { tutor, sepa, hayReutilizacion: tutor || (s.tieneHermanos && sepa) }
}
