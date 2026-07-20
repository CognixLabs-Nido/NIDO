/**
 * F11-G — modelo del wizard de alta del tutor, ahora de **8 pasos** con documentos. Cada
 * paso persiste por su cuenta (guardable y reanudable). El paso `cuenta` (creación de la
 * cuenta del tutor 1) vive en `/invitation/[token]` (pre-login); del paso 2 en adelante el
 * MISMO wizard corre en `/alta/[ninoId]` ya autenticado (arquitectura A). Por eso en `/alta`
 * el paso `cuenta` queda inalcanzable (clamp `PASO_MIN_AUTENTICADO`).
 *
 * El último paso es `sepa` (G-2): IBAN + mandato SEPA firmado. Es opcional (omitible) y al
 * guardarlo —o al omitirlo— finaliza el alta (`finalizarAlta`).
 */
export const PASOS_ALTA = [
  'cuenta',
  'acuses',
  'menor',
  'tutor1',
  'tutor2',
  'medico',
  'emergencia',
  'sepa',
] as const

export type PasoAlta = (typeof PASOS_ALTA)[number]

/**
 * En `/alta` (post-login) el primer paso navegable es `acuses` (la cuenta ya está hecha en
 * `/invitation`). El wizard SIEMPRE arranca aquí: recorre todos los pasos en orden y es el
 * gate de finalizar quien exige la completitud, no el arranque.
 *
 * NOTA — hubo un heurístico de "reanudación" (`pasoInicialAlta`) que saltaba a `medico`/
 * `emergencia` según identidad + acuse médico. Se retiró: como el alta nace con la identidad
 * ya cargada (`invitar-al-alta` fija nombre/apellidos/fecha), el salto se disparaba en la
 * PRIMERA entrada y el tutor se saltaba acuses/menor/tutor (normas, imagen, documentos).
 */
export const PASO_MIN_AUTENTICADO = PASOS_ALTA.indexOf('acuses')
