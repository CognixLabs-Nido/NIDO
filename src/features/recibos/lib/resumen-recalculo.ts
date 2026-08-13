/**
 * R-1 · Recibos — el REPORTE del botón "Recalcular el mes".
 *
 * Encadenar `proponer_asignaciones` + `generar_recibos_mes` no basta: el problema que
 * arrastraba el botón viejo era de PERCEPCIÓN. Devolvía un entero pelado y, en cuanto no
 * había nada nuevo que sembrar, el toast decía "0" y se leía como "no funciona" (cuando
 * en realidad la respuesta correcta era "todo al día"). Aquí se decide, a partir de los
 * recuentos reales, qué frases componen el aviso — nunca un cero desnudo.
 *
 * Es una función pura para poder fijar esa decisión en tests sin i18n ni red.
 */

/** Lo que de verdad hizo el recálculo, medido contra la BD (no estimado). */
export interface RecalculoResumen {
  /** Filas nuevas en `asignacion_concepto` (medidas por diff antes/después). */
  conceptosSembrados: number
  /** Niños distintos que recibieron alguna de esas filas. */
  ninosAfectados: number
  /** Familias distintas que recibieron alguna (conceptos de ámbito familia). */
  familiasAfectadas: number
  /** Lo que devolvió `generar_recibos_mes`. */
  recibosRegenerados: number
  /** Confirmados del mes contados ANTES de regenerar: el motor no los toca. */
  confirmadosIntactos: number
}

/** Una frase del aviso: clave i18n + sus valores de interpolación. */
export interface FraseResumen {
  clave: string
  valores?: Record<string, number>
}

/**
 * Compone el aviso. Reglas:
 *  - si no se sembró nada, se dice "todo al día" EN PALABRAS, no "0 conceptos";
 *  - el desglose por familias solo aparece si de verdad hubo alguna (el catálogo puede
 *    no tener conceptos de ámbito familia, y una frase "0 familias" es ruido);
 *  - los confirmados intactos SIEMPRE se nombran: es la garantía que el usuario necesita
 *    leer antes de pulsar, y en 0 significa "no había ninguno", que también informa.
 */
export function componerResumenRecalculo(r: RecalculoResumen): FraseResumen[] {
  const frases: FraseResumen[] = []

  if (r.conceptosSembrados === 0) {
    frases.push({ clave: 'recalculo_conceptos_ninguno' })
  } else {
    frases.push({
      clave: 'recalculo_conceptos',
      valores: { conceptos: r.conceptosSembrados, ninos: r.ninosAfectados },
    })
    if (r.familiasAfectadas > 0) {
      frases.push({ clave: 'recalculo_familias', valores: { familias: r.familiasAfectadas } })
    }
  }

  frases.push({ clave: 'recalculo_recibos', valores: { recibos: r.recibosRegenerados } })
  frases.push({
    clave: 'recalculo_confirmados',
    valores: { confirmados: r.confirmadosIntactos },
  })

  return frases
}
