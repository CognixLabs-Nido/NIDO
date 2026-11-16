import type { Database } from '@/types/db'

/**
 * Fase 9 — los gastos de gestión del alta. Lo que vale en los dos lados (servidor y cliente): la
 * forma de los datos y las reglas puras, cada una copiada de la base.
 */

/** Las formas, copiadas del CHECK `gastos_gestion_forma_check`. */
export const FORMAS_GASTOS = ['transferencia', 'efectivo'] as const
export type FormaGastos = (typeof FORMAS_GASTOS)[number]

export function esFormaGastos(v: unknown): v is FormaGastos {
  return v === 'transferencia' || v === 'efectivo'
}

/**
 * Los tipos del justificante y su extensión, copiados de `allowed_mime_types` del bucket
 * `justificantes-gestion`; las extensiones, del CHECK `gastos_gestion_ruta_del_nino`.
 */
export const TIPOS_JUSTIFICANTE: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

/** El tope del bucket (`file_size_limit` = 15728640). */
export const MAX_JUSTIFICANTE_BYTES = 15 * 1024 * 1024

/** Lo que acepta el `<input type="file">`, de la misma tabla. */
export const ACCEPT_JUSTIFICANTE = Object.keys(TIPOS_JUSTIFICANTE).join(',')

/**
 * ¿Es la ruta de un justificante de ESTE niño? Espejo del CHECK `gastos_gestion_ruta_del_nino` (y
 * de la cláusula `gastos_gestion` de `cambios_pendientes_ruta_documento_del_nino`).
 */
export function rutaJustificanteDelNino(path: string, centroId: string, ninoId: string): boolean {
  const prefijo = `${centroId}/${ninoId}/`
  return (
    path.startsWith(prefijo) &&
    /^[A-Za-z0-9_-]+\.(pdf|jpg|jpeg|png|heic|heif)$/.test(path.slice(prefijo.length))
  )
}

type FilaNino = Database['public']['Functions']['gastos_gestion_nino']['Returns'][number]

/** Los gastos de un curso, como los devuelve `gastos_gestion_nino` (el curso del alta). */
export interface GastosCurso {
  cursoId: string
  cursoNombre: string
  /** Lo que debe este niño: el propio si Dirección lo cambió, si no el del curso. */
  importe: number
  importeCurso: number
  importePropio: boolean
  forma: FormaGastos | null
  justificantePath: string | null
  cobradoAt: string | null
  matriculaPendiente: boolean
}

/** Las filas de la base, sin las que no traen lo que la función garantiza. */
export function deFilasNino(filas: readonly FilaNino[]): GastosCurso[] {
  return filas.flatMap((f) =>
    f.curso_academico_id && f.importe !== null && f.importe_curso !== null
      ? [
          {
            cursoId: f.curso_academico_id,
            cursoNombre: f.curso_nombre ?? '',
            importe: f.importe,
            importeCurso: f.importe_curso,
            importePropio: f.importe_propio === true,
            forma: esFormaGastos(f.forma) ? f.forma : null,
            justificantePath: f.justificante_path,
            cobradoAt: f.cobrado_at,
            matriculaPendiente: f.matricula_pendiente === true,
          },
        ]
      : []
  )
}

/**
 * Los cursos que faltan por contestar: espejo de `privado.gastos_sin_contestar` (sin forma, sin
 * cobrar y con importe; con 0 no hay nada que contestar). Es la regla del cierre del alta.
 */
export function porContestar(gastos: readonly GastosCurso[]): GastosCurso[] {
  return gastos.filter((g) => g.forma === null && g.cobradoAt === null && g.importe > 0)
}
