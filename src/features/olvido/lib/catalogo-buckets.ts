/**
 * Fase 7 (2026-11-13, pedido por el responsable): el catálogo de buckets frente al olvido.
 *
 * La purga borra los ficheros según una lista escrita a mano (`FUENTES_ADJUNTOS`), y nada la
 * comparaba con los buckets que existen: un bucket que alguien olvidara añadir sobreviviría a un
 * borrado del art. 17 sin que nada se pusiera rojo. D8 pedía comprobar que la purga alcanza los
 * buckets nuevos; esto cubre también los que vengan (el justificante de gastos de gestión de la
 * fase 9, antes de existir).
 *
 * Cada bucket que existe está en uno de los dos sitios:
 * - lo recorre el olvido (`FUENTES_ADJUNTOS`), o
 * - está aquí fuera, con el MOTIVO y con QUIÉN lo borra. Un motivo que no nombra a quien lo borra no
 *   vale: «no hace falta» es exactamente lo que se olvida.
 *
 * `catalogo-buckets.rls.test.ts` lo compara con `storage.buckets` de la base efímera (las
 * migraciones de verdad).
 */
export const BUCKETS_FUERA_DEL_OLVIDO: Readonly<Record<string, string>> = {
  'centro-assets':
    'Del centro (el logo y su imagen), no de una persona. Se van con el centro, no con un sujeto.',
  'documentos-centro':
    'Los documentos del centro (presupuesto, normas), no de una persona. La firma de cada familia ' +
    'vive en la tabla de firmas, que purga la base.',
  'mandato-sepa':
    'Prueba fiscal (el mandato firmado): no lo borra el olvido sino la retención fiscal cuando vence ' +
    '(`retencion/lib/fiscal.ts`).',
  'recogida-adjuntos':
    'DNI de terceros en las firmas de recogida (#7): prueba con retención legal. Los borra la ' +
    'retención por tiempo (`FUENTES_RETENCION`, `dni-recogida`).',
  'remesas-ficheros':
    'Los ficheros del banco (remesas): retención fiscal. Los borra `retencion/lib/ficheros-remesa.ts`.',
}

/**
 * Buckets que la base efímera tiene y producción NO: se borraron por la API de Storage (que no deja
 * borrarlos por SQL), y la migración que los creó sigue ahí, así que la efímera los recrea. No son
 * «fuera del olvido»: en producción no hay nada que borrar. El test afirma que siguen en la efímera
 * (si no, esta lista se pudre) y vacíos.
 */
export const BUCKETS_BORRADOS_EN_PRODUCCION: Readonly<Record<string, string>> = {
  'cartilla-vacunas':
    'Fase 11-F (`20260620120000_phase11_f_teardown_cartilla_acuse.sql`): la cartilla se quitó y el ' +
    'bucket se borró por la API. Ausente en producción, medido el 2026-11-13 (10 buckets).',
}

export interface ResultadoCatalogo {
  /** Existen y nadie dice qué pasa con ellos al olvidar a alguien: lo que tiene que poner rojo. */
  sinDueno: string[]
  /** Están en el catálogo y no existen: un catálogo que se pudre también miente. */
  inexistentes: string[]
  /** En los dos sitios a la vez: o lo borra el olvido o está fuera, no las dos cosas. */
  enLosDos: string[]
}

export function compararCatalogoBuckets(
  reales: readonly string[],
  delOlvido: readonly string[],
  fuera: readonly string[]
): ResultadoCatalogo {
  const r = new Set(reales)
  const o = new Set(delOlvido)
  const f = new Set(fuera)
  const ord = (xs: Iterable<string>) => [...xs].sort()
  return {
    sinDueno: ord([...r].filter((b) => !o.has(b) && !f.has(b))),
    inexistentes: ord([...new Set([...o, ...f])].filter((b) => !r.has(b))),
    enLosDos: ord([...o].filter((b) => f.has(b))),
  }
}
