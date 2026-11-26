import { esLecturaFallida } from './lectura-fallida'
import { logger } from './logger'

/**
 * La frontera de las Server Actions para una lectura fallida (censo C, decisión de Jose del 2026-11-25):
 * una acción no deja escapar una `LecturaFallida` hacia el cliente (convención: «patrón Result, nunca
 * throw visible al cliente»); la convierte en `{ success: false, error: 'common.lectura_fallida' }`. Así
 * no se queda colgado el «guardando…» de la pantalla.
 *
 * Solo recoge `LecturaFallida`: cualquier otro error (también `redirect()` y `notFound()` de Next) sigue
 * subiendo tal cual.
 *
 * OJO, lo que NO resuelve (Jose): «convertir el throw en un fail evita el spinner colgado, y NO evita que
 * la pantalla diga «no se guardó» después de haber guardado». Eso se arregla sitio por sitio, y lo vigila
 * el escáner de cadena de la CI (`scripts/ci/cadena-tras-escritura.cjs`).
 *
 * Uso, el cuerpo entero de la acción:  try { … } catch (e) { return falloDeLectura(e) }
 */
export function falloDeLectura(e: unknown): { success: false; error: string } {
  if (!esLecturaFallida(e)) throw e
  logger.error(`acción: lectura fallida (${e.donde})`, { code: e.codigo })
  return { success: false, error: 'common.lectura_fallida' }
}

/**
 * Lo mismo para las acciones que cuentan (los badges que se refrescan desde el cliente): con la lectura
 * caída, `{ total: null }`, y el badge pinta «?» (`ContadorNoLeido`), nunca un 0 ni el número de antes.
 */
export function contadorNoLeido(e: unknown): { total: null } {
  if (!esLecturaFallida(e)) throw e
  logger.error(`contador: lectura fallida (${e.donde})`, { code: e.codigo })
  return { total: null }
}
