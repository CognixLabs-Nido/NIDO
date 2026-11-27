import { esLecturaFallida } from './lectura-fallida'
import { logger } from './logger'

/**
 * Una lectura fallida DESPUÉS de una escritura ya hecha (censo C, decisión de Jose del 2026-11-25: «¿este
 * arreglo convierte en fallo algo que hoy funciona?»). Parar aquí diría «no se guardó» sobre algo que sí
 * se guardó, y quien reintenta duplica (una invitación, un centro). Así que no para: lo de después sigue
 * con su valor por defecto (el correo en el idioma por defecto, sin el nombre del centro, sin la vista
 * previa) y el fallo va a Sentry (`logger.error`), no a la nada.
 *
 * Es un nombre a propósito: quien lea `lecturaFallidaTrasEscritura` sabe por qué esa lectura no para, y
 * el escáner de la CI (`scripts/ci/cadena-tras-escritura.cjs`) lo cuenta como tratado.
 */
export function lecturaFallidaTrasEscritura(
  donde: string,
  error: { code?: string; message?: string } | null | undefined
): void {
  logger.error(`lectura fallida tras escribir (${donde})`, { code: error?.code ?? null })
}

/**
 * Una escritura SECUNDARIA que falla después de la principal ya hecha (censo C, 2026-11-26; la misma regla
 * que la de arriba): la cuenta ya está creada, el recibo ya está guardado… y lo que falla es lo de después
 * (el sello de aceptación, el idioma copiado). Deshacer la principal o decir «no se guardó» haría que se
 * reintentara sobre algo que existe. No para, y el fallo va a Sentry (`logger.error`), no a un `warn` que
 * nadie lee. Si quien actúa puede hacer algo con ello, se le dice además; si no, es cosa de quien opera.
 */
export function escrituraSecundariaFallida(
  donde: string,
  error: { code?: string; message?: string } | null | undefined
): void {
  logger.error(`escritura secundaria fallida (${donde})`, { code: error?.code ?? null })
}

/**
 * Una lectura que va DESPUÉS de una escritura hecha y que el codemod hizo lanzar (`LecturaFallida`):
 * si falla, devuelve `porDefecto` (lo que pasaba antes del censo C) y deja el fallo en Sentry. Solo
 * recoge `LecturaFallida`: cualquier otro error sigue subiendo. Ejemplo: firmar la vista previa de una
 * foto ya guardada (sin la vista previa, la foto está; con un 500, se volvería a subir).
 */
export async function siFallaTrasEscribir<T>(
  donde: string,
  lectura: Promise<T>,
  porDefecto: T
): Promise<T> {
  try {
    return await lectura
  } catch (e) {
    if (!esLecturaFallida(e)) throw e
    lecturaFallidaTrasEscritura(donde, { code: e.codigo ?? undefined, message: e.message })
    return porDefecto
  }
}
