import { createHash } from 'crypto'

/** Separador entre el texto y los datos canónicos en el hash compuesto (0x01,
 *  un byte de control que no aparece en texto legal ni en JSON). */
const SEP = String.fromCharCode(1)

/**
 * Normaliza el texto antes de hashear para que el hash sea **estable e
 * inequívoco**: normaliza saltos de línea (CRLF/CR → LF) y recorta espacios al
 * final. NO toca el contenido interno — el texto legal se hashea tal cual lo vio
 * el firmante (salvo el ruido de fin de línea que introducen distintos clientes).
 */
export function normalizarTexto(texto: string): string {
  return texto.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '')
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

/**
 * Canonicaliza recursivamente: ordena las claves de los objetos (recursivo),
 * conserva el orden de los arrays (el orden de la lista es significativo) y deja
 * los primitivos intactos. NO depende del orden incidental de `JSON.stringify`:
 * reconstruye los objetos insertando las claves ya ordenadas. Resultado **estable
 * bit a bit** para una misma entrada → el hash es reproducible y verificable.
 */
function canonicalizar(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalizar)
  const out: { [k: string]: JsonValue } = {}
  for (const k of Object.keys(value).sort()) out[k] = canonicalizar(value[k])
  return out
}

/** Serialización canónica (claves ordenadas recursivamente) de un valor JSON. */
export function canonicalJSON(value: JsonValue): string {
  return JSON.stringify(canonicalizar(value))
}

/**
 * Hash SHA-256 (hex de 64 chars) de la **firma**: ata el texto exacto y, si los
 * hay, los **datos estructurados firmados** (recogida: la lista de personas).
 * Se computa **siempre server-side** y debe coincidir con el de la versión
 * vigente — prueba de integridad de F8.
 *
 * **Invariante de compatibilidad (crítico):** sin datos (o datos vacío `{}`) el
 * hash es `sha256(normalizarTexto(texto))` **EXACTO** —sin separador ni canonical
 * vacío— para que las firmas de F8-1/F8-2b (salida/reglas) sigan verificando.
 * Con datos: `sha256( normalizar(texto) + 0x01 + canonicalJSON(datos) )`.
 */
export function hashFirma(texto: string, datos?: JsonValue): string {
  const base = normalizarTexto(texto)
  const tieneDatos =
    datos != null && typeof datos === 'object' && !Array.isArray(datos)
      ? Object.keys(datos).length > 0
      : datos != null
  const payload = tieneDatos ? `${base}${SEP}${canonicalJSON(datos as JsonValue)}` : base
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

/**
 * Hash del texto exacto de una autorización (sin datos). Mantiene la firma de
 * F8-1/F8-2b; delega en `hashFirma` con el invariante de compatibilidad. El CHECK
 * de BD exige `^[0-9a-f]{64}$`.
 */
export function hashTextoAutorizacion(texto: string): string {
  return hashFirma(texto)
}
