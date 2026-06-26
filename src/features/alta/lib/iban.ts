/**
 * F11-G-2 — validación de IBAN (estructura + dígitos de control mód-97, ISO 13616).
 * Funciones PURAS (sin DOM ni `server-only`): las usa el formulario del paso SEPA en
 * cliente y la ruta de subida en servidor, y se cubren con tests unitarios. No valida la
 * existencia real de la cuenta (eso es del banco), solo el formato y el checksum.
 */

/** Longitud del IBAN por país (ISO 13616). Subconjunto SEPA habitual; ampliable. */
const LONGITUD_POR_PAIS: Record<string, number> = {
  ES: 24,
  AD: 24,
  AT: 20,
  BE: 16,
  CH: 21,
  DE: 22,
  FI: 18,
  FR: 27,
  GB: 22,
  IE: 22,
  IT: 27,
  LU: 20,
  MC: 27,
  NL: 18,
  PT: 25,
}

/** Quita espacios/guiones y pasa a mayúsculas (forma canónica para almacenar/validar). */
export function normalizarIban(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase()
}

/** Agrupa en bloques de 4 para mostrar (`ES91 2100 0418 4502 0005 1332`). */
export function formatearIban(raw: string): string {
  return normalizarIban(raw)
    .replace(/(.{4})/g, '$1 ')
    .trim()
}

/** Reordena (mueve los 4 primeros al final) y convierte letras a números (A=10…Z=35). */
function aRestoMod97(iban: string): number {
  const reordenado = iban.slice(4) + iban.slice(0, 4)
  const expandido = reordenado.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  // Mód-97 por tramos para no desbordar Number con enteros muy largos.
  let resto = 0
  for (let i = 0; i < expandido.length; i += 7) {
    resto = Number(String(resto) + expandido.slice(i, i + 7)) % 97
  }
  return resto
}

/**
 * ¿IBAN con estructura y checksum válidos? Exige 2 letras de país + 2 dígitos de control +
 * BBAN alfanumérico, longitud total entre 15 y 34 (y la del país si se conoce), y
 * `mód-97 === 1`.
 */
export function ibanValido(raw: string): boolean {
  const iban = normalizarIban(raw)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  if (iban.length < 15 || iban.length > 34) return false
  const pais = iban.slice(0, 2)
  const esperada = LONGITUD_POR_PAIS[pais]
  if (esperada !== undefined && iban.length !== esperada) return false
  return aRestoMod97(iban) === 1
}
