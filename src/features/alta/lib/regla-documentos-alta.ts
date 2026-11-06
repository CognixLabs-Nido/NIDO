/**
 * La regla de los documentos del centro en el cierre del alta (fase 4, 4b-2; decisiones del
 * 2026-11-06 en `docs/specs/altas-serie.md`). Vive en tres sitios, y los tres dicen lo mismo:
 *
 *  - aquí, para el gate de `finalizarAlta` y el avance de «Altas en proceso»;
 *  - en la base, `marcar_matricula_lista` (`20270109120000`):
 *    `d.obligatorio AND d.estado = 'por_firmar'`, sobre `privado.documentos_del_nino`, que es lo
 *    que devuelve `documentos_firma_nino` a la app.
 *
 * Un documento obligatorio por firmar frena el alta. Uno que el centro todavía no ha subido
 * (`falta_documento`) no (P-6: la familia lo firma cuando exista), ni uno opcional. Hasta que el
 * centro suba sus normas, el alta se cierra sin normas: es el único momento de la historia del
 * producto en que pasa.
 */
export interface DocumentoEnElCierre {
  obligatorio: boolean
  estado: string
}

/** ¿Este documento impide cerrar el alta? */
export function frenaElAlta(d: DocumentoEnElCierre): boolean {
  return d.obligatorio && d.estado === 'por_firmar'
}

/**
 * ¿Hay algo que la familia tenga que firmar, o haya firmado, entre lo obligatorio? Sin eso, la
 * línea del avance no sale: «hecho» por un documento que no existe diría que la familia hizo algo
 * que no hizo (como la del SEPA sin CID del centro).
 */
export function hayObligatorioSubido(docs: readonly DocumentoEnElCierre[]): boolean {
  return docs.some((d) => d.obligatorio && d.estado !== 'falta_documento')
}
