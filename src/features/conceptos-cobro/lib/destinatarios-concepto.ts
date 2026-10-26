/**
 * A quién se le asigna un concepto desde el propio concepto: los niños (con su clase) o las
 * familias, según su ámbito. La pestaña Asignación permanente escribe las mismas filas.
 */
export interface Destinatario {
  id: string
  nombre: string
  /** La clase del niño; en una familia, null. */
  aula: string | null
}

/** Lo que se manda a `fijar_asignaciones_concepto`: un cambio por niño o familia. */
export interface CambioAsignacion {
  id: string
  asignada: boolean
}

/** Los conceptos que se asignan desde el concepto: los mismos que ofrece Asignación permanente. */
export function conceptoAsignable(c: { activo: boolean; aplicacion: string }): boolean {
  return c.activo && c.aplicacion === 'manual'
}

/**
 * Lo marcado y desmarcado entre lo que trajo la página y lo que hay ahora en pantalla: solo lo que
 * cambia, para que guardar no reescriba lo que ya estaba.
 */
export function cambiosAsignacion(
  inicial: ReadonlySet<string>,
  actual: ReadonlySet<string>
): CambioAsignacion[] {
  const cambios: CambioAsignacion[] = []
  for (const id of new Set([...inicial, ...actual])) {
    const ahora = actual.has(id)
    if (inicial.has(id) !== ahora) cambios.push({ id, asignada: ahora })
  }
  return cambios.sort((a, b) => a.id.localeCompare(b.id))
}
