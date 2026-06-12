/**
 * Derivaciones puras del aviso de inicio (patrón #64, sin tabla de eventos). Aisladas
 * aquí (sin `server-only` ni Supabase) para poder testearlas sin remoto.
 */

/**
 * Cuenta cuántas filas (identificadas por `id`) NO están en el mapa de "vistos"
 * `{ [id]: iso }`. Es la base de los avisos "hay N informes/publicaciones nuevas":
 * la RLS de la tabla origen ya filtró lo visible; aquí solo descontamos lo ya abierto
 * (basta la PRESENCIA de la clave — editar/republicar no re-avisa).
 */
export function contarNoVistas(filas: { id: string }[], vistos: Record<string, string>): number {
  return filas.filter((r) => !vistos[r.id]).length
}
