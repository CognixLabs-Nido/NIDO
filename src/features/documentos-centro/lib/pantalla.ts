/**
 * La pantalla de la admin (3c): la forma de `documentos_centro_admin` (3a, `20270101120000`) y lo que
 * la pantalla hace con ella. Sin servidor ni React: se prueba sola.
 */

export interface VersionAdmin {
  id: string
  curso_academico_id: string | null
  numero: number
  sha256: string
  bytes: number
  subida_at: string
  /** La de número mayor de ESE documento y ESE curso (la base lo calcula). */
  vigente: boolean
}

export interface DocumentoAdmin {
  id: string
  titulo: string
  de_curso: boolean
  obligatorio: boolean
  orden: number
  retirado_at: string | null
  versiones: VersionAdmin[]
}

export interface ListaAdmin {
  documentos: DocumentoAdmin[]
  ficheros_sueltos: string[]
}

export interface CursoDeLaPantalla {
  id: string
  nombre: string
  estado: 'planificado' | 'activo' | 'cerrado'
}

/** Un grupo de versiones del mismo curso (o sin curso, en un documento que no es de curso). */
export interface GrupoDeCurso {
  cursoId: string | null
  /** El nombre del curso; `null` sin curso, o si el curso ya no está en la lista del centro. */
  cursoNombre: string | null
  versiones: VersionAdmin[]
}

/** La respuesta de la base, sin fiarse de su forma: lo que no es una lista sale como lista vacía. */
export function leerListaAdmin(data: unknown): ListaAdmin {
  const d = (data ?? {}) as Partial<ListaAdmin>
  return {
    documentos: Array.isArray(d.documentos) ? d.documentos : [],
    ficheros_sueltos: Array.isArray(d.ficheros_sueltos) ? d.ficheros_sueltos : [],
  }
}

/**
 * Las versiones de un documento por curso: hay varias vivas a la vez, una por curso (3a), y la
 * pantalla las enseña así. Los cursos van del más reciente al más antiguo (el orden de `cursos`, que
 * llega por fecha de inicio descendente); dentro, de número mayor a menor.
 */
export function agruparPorCurso(
  versiones: VersionAdmin[],
  cursos: CursoDeLaPantalla[]
): GrupoDeCurso[] {
  const grupos = new Map<string | null, VersionAdmin[]>()
  for (const v of versiones) {
    const g = grupos.get(v.curso_academico_id) ?? []
    g.push(v)
    grupos.set(v.curso_academico_id, g)
  }
  const posicion = new Map(cursos.map((c, i) => [c.id, i]))
  const nombre = new Map(cursos.map((c) => [c.id, c.nombre]))
  return [...grupos.entries()]
    .map(([cursoId, vs]) => ({
      cursoId,
      cursoNombre: cursoId ? (nombre.get(cursoId) ?? null) : null,
      versiones: [...vs].sort((a, b) => b.numero - a.numero),
    }))
    .sort(
      (a, b) =>
        (a.cursoId ? (posicion.get(a.cursoId) ?? cursos.length) : -1) -
        (b.cursoId ? (posicion.get(b.cursoId) ?? cursos.length) : -1)
    )
}

/** Cuántas firmas tiene cada versión, de las filas `{ version_id }` que la admin puede leer. */
export function contarFirmas(filas: { version_id: string }[]): Record<string, number> {
  const n: Record<string, number> = {}
  for (const f of filas) n[f.version_id] = (n[f.version_id] ?? 0) + 1
  return n
}

/**
 * Si la pantalla ofrece borrar la versión (J5): solo con cero firmas. Es lo que se enseña, no la
 * regla: la base vuelve a mirarlo, y una firma que la admin no ve (bloqueada) la para igual.
 */
export function sePuedeOfrecerBorrar(firmas: Record<string, number>, versionId: string): boolean {
  return (firmas[versionId] ?? 0) === 0
}

/** «De curso» solo se cambia mientras el documento no tenga versiones (J6). */
export function sePuedeCambiarDeCurso(doc: Pick<DocumentoAdmin, 'versiones'>): boolean {
  return doc.versiones.length === 0
}

/** Los cursos para los que se puede subir una versión: `planificado` o `activo`, nunca `cerrado`. */
export function cursosParaSubir(cursos: CursoDeLaPantalla[]): CursoDeLaPantalla[] {
  return cursos.filter((c) => c.estado !== 'cerrado')
}
