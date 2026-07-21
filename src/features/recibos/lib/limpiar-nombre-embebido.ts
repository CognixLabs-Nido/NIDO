/**
 * Quita el nombre embebido del niño (" · Pepe") de la descripción cruda de una línea de
 * recibo. DEFENSIVO para recibos VIEJOS anteriores a B3: desde B3 el motor
 * (`generar_recibos_mes`) ya NO pega el nombre en la descripción, pero un recibo generado
 * antes y aún sin regenerar puede traerlo. El motor embebía solo el PRIMER nombre del niño
 * (`ninos.nombre`), así que el llamante debe pasar ese token (p. ej. `nombre.split(' ')[0]`).
 *
 * Módulo puro (sin `server-only`): lo usan el PDF del padre (B4) y la vista interna del
 * director (B3). No duplicar.
 */
export function limpiarNombreEmbebido(descripcion: string, primerNombre: string | null): string {
  if (!primerNombre) return descripcion
  return descripcion.replaceAll(` · ${primerNombre}`, '').trim()
}
