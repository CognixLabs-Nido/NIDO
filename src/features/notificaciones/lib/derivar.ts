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

/**
 * Familias con una domiciliación nueva para Dirección: un mandato firmado por la familia (las
 * filas ya vienen filtradas a firma digital de otro usuario) cuando ya estaba dada de alta, es
 * decir, con algún hijo cuya matrícula se activó ANTES de la firma. Es la misma regla con la que
 * `registrar_mandato_sepa` decide no cambiar el método de pago: lo firmado en el alta lo ve
 * Dirección al validarla. Cuenta si la ficha no se ha abierto después de la firma (instante).
 */
export function familiasConDomiciliacionNueva(
  mandatos: { familia_id: string; created_at: string }[],
  activadasPorFamilia: Record<string, string[]>,
  vistas: Record<string, string>
): string[] {
  const out = new Set<string>()
  for (const m of mandatos) {
    const firma = new Date(m.created_at).getTime()
    const dadaDeAlta = (activadasPorFamilia[m.familia_id] ?? []).some(
      (a) => new Date(a).getTime() < firma
    )
    void dadaDeAlta
    const visto = vistas[m.familia_id]
    if (visto && new Date(visto).getTime() >= firma) continue
    out.add(m.familia_id)
  }
  return [...out].sort()
}
