import { logger } from '@/shared/lib/logger'

import { esLecturaFallida } from './lectura-fallida'

/**
 * Para las SECCIONES de una pantalla (censo C, decisión de Jose del 2026-11-25): los layouts y las seis
 * pantallas diarias. Si la lectura falla (`LecturaFallida`), devuelve `null` —«no se pudo leer»— y la
 * pantalla sigue; quien la pinta lo dice en esa parte. Cualquier otro error sigue subiendo: esto no es un
 * `catch` genérico.
 *
 * `null` aquí significa SOLO «no se pudo leer». Si la lectura puede devolver null de verdad («no hay»),
 * quien llama lo envuelve (`{ valor }`) para no confundir los dos.
 */
export async function oNoLeido<T>(lectura: Promise<T>, donde: string): Promise<T | null> {
  try {
    return await lectura
  } catch (e) {
    if (!esLecturaFallida(e)) throw e
    logger.error(`sección no leída: ${donde}`, e.message)
    return null
  }
}
