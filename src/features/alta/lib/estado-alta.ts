/**
 * F11-G — modelo del wizard de alta del tutor, ahora de **8 pasos** con documentos. Cada
 * paso persiste por su cuenta (guardable y reanudable). El paso `cuenta` (creación de la
 * cuenta del tutor 1) vive en `/invitation/[token]` (pre-login); del paso 2 en adelante el
 * MISMO wizard corre en `/alta/[ninoId]` ya autenticado (arquitectura A). Por eso en `/alta`
 * el paso `cuenta` queda inalcanzable (clamp `PASO_MIN_AUTENTICADO`).
 *
 * El último paso es `firma` (10b-2): la familia firma la ficha y eso cierra el alta. En el alta en
 * papel no hay paso de firma (llega con la 10b-3) y el último que queda finaliza (`finalizarAlta`).
 */
export const PASOS_ALTA = [
  'cuenta',
  'acuses',
  'menor',
  'tutor1',
  'tutor2',
  'medico',
  'emergencia',
  // Fase 8b: la petición de servicios. Antes de `sepa` para que los índices de los demás no cambien.
  'servicios',
  // Fase 9: los gastos de gestión, si el curso del alta tiene importe. También antes de `sepa`.
  'gastos',
  'sepa',
  // Fase 10b-2: firmar la ficha es el último paso y cierra el alta («firmar es finalizar»). No en el
  // alta en papel: su firma en papel llega con la 10b-3, y hasta entonces termina con «Finalizar».
  'firma',
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

/**
 * Los pasos del alta de un centro. Sin CID del centro no se firma ningún mandato (0c,
 * 2026-11-04): el paso `sepa` no aparece y el alta se completa en efectivo, como cuando la familia
 * omite. Sin ningún concepto de servicio en Cuotas, el paso `servicios` tampoco (fase 8b, como el
 * SEPA sin CID). Sin importe de gastos de gestión para el curso del alta, el paso `gastos` tampoco
 * (fase 9: «un centro sin importe no ve el paso»). Con la familia, el último es `firma` (10b-2), que
 * cierra el alta al firmar; en el alta en papel (`conFirma` falso) no hay paso de firma y el último que
 * queda finaliza.
 */
export function pasosAlta(
  centroTieneCid: boolean,
  centroTieneServicios: boolean,
  cursoTieneGastos: boolean,
  conFirma: boolean
): readonly PasoAlta[] {
  return PASOS_ALTA.filter(
    (p) =>
      (p !== 'sepa' || centroTieneCid) &&
      (p !== 'servicios' || centroTieneServicios) &&
      (p !== 'gastos' || cursoTieneGastos) &&
      (p !== 'firma' || conFirma)
  )
}
