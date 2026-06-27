'use server'

import { z } from 'zod'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  BUCKET_DNI_TUTORES,
  BUCKET_LIBRO_FAMILIA,
  BUCKET_MANDATO_SEPA,
  borrarObjetosBucket,
} from '@/shared/lib/adjuntos/storage'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'
import { fechaLimitePurga } from '../queries/get-cursos-purgables'

const purgarCursoSchema = z.object({
  cursoId: z.string().uuid(),
  /** Confirmación: el admin teclea el nombre EXACTO del curso (doble validación, decisión H). */
  confirmacionNombre: z.string().min(1),
})
export type PurgarCursoInput = z.infer<typeof purgarCursoSchema>

/**
 * F11-G (decisión H) — purga semimanual de un curso cuyo fin fue hace ≥5 años. **Manual, sin
 * cron**, con **doble validación**: (1) el admin teclea el nombre exacto del curso; (2) el
 * servidor re-verifica el corte de 5 años. Solo afecta a niños del curso que **ya no están
 * matriculados activos** (alumni): a un niño re-matriculado no se le toca nada.
 *
 * **G-4 — borra también el DATO ESTRUCTURADO** (no solo los PDFs), para cumplir la retención
 * RGPD de 5 años: el "derecho al olvido" exige eliminar el dato, no solo el fichero.
 *
 * **Qué se BORRA (hard delete / anulado):**
 *  - Ficheros de Storage: libro de familia, DNI de tutores, mandato SEPA (vía Storage API; el
 *    trigger `protect_delete` de `storage.objects` bloquea el DELETE por SQL).
 *  - Filas `datos_tutor` (identidad/dirección/DNI del tutor del alta) — HARD delete, no soft:
 *    `deleted_at` conservaría el dato y no cumpliría el olvido.
 *  - Filas `mandatos_sepa` (IBAN cifrado, titular, identificador) — HARD delete.
 *  - Filas `cambios_pendientes` del menor (cola de validación) — HARD delete.
 *  - Datos de alta del menor en `ninos`: dirección + estado civil → se **anulan** (NO se borra
 *    la ficha del niño: su identidad core entra en el "derecho al olvido" general de F11-B).
 *
 * **Qué se CONSERVA por obligación legal / fuera de scope:**
 *  - `audit_log`: registro append-only inmutable (trazabilidad legal). **No se purga.** Matiz
 *    RGPD: anular columnas de `ninos` (tabla auditada) copia la dirección a `valores_antes` →
 *    su redacción es el ítem "olvido en audit_log" de F11-B (ver follow-ups; puede requerir
 *    abogado). Las 3 tablas borradas NO están auditadas → su DELETE no copia PII al log.
 *  - Cuenta de usuario del tutor (`usuarios`) y `vinculos_familiares`: baja de cuenta = flujo
 *    RGPD aparte (un tutor puede seguir teniendo otros hijos activos).
 *
 * Factibilidad sin SQL: ninguna de las 3 tablas tiene trigger de protección de DELETE ni FK
 * entrante con RESTRICT; el **service role** bypassa la RLS (default-DENY) y las borra.
 */
export async function purgarCurso(
  input: PurgarCursoInput
): Promise<ActionResult<{ documentos: number; filas: number; ninos: number }>> {
  const parsed = purgarCursoSchema.safeParse(input)
  if (!parsed.success) return fail('admin.purga.errors.invalido')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('admin.purga.errors.no_autorizado')

  // Curso visible para el admin (RLS limita a su centro) + datos para la doble validación.
  const { data: curso } = await supabase
    .from('cursos_academicos')
    .select('id, nombre, fecha_fin, centro_id')
    .eq('id', parsed.data.cursoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!curso) return fail('admin.purga.errors.curso_no_encontrado')

  // Autorización explícita: service role bypassa RLS, así que el gate admin va aquí.
  const { data: rolAdmin } = await supabase
    .from('roles_usuario')
    .select('id')
    .eq('usuario_id', user.id)
    .eq('centro_id', curso.centro_id)
    .eq('rol', 'admin')
    .is('deleted_at', null)
    .maybeSingle()
  if (!rolAdmin) return fail('admin.purga.errors.no_autorizado')

  // Doble validación: nombre tecleado + corte de 5 años re-verificado server-side.
  if (parsed.data.confirmacionNombre.trim() !== curso.nombre) {
    return fail('admin.purga.errors.nombre_no_coincide')
  }
  if (curso.fecha_fin > fechaLimitePurga()) return fail('admin.purga.errors.no_purgable')

  const service = createServiceRoleClient()

  // Niños del curso (histórico de matrículas).
  const { data: matriculasCurso } = await service
    .from('matriculas')
    .select('nino_id')
    .eq('curso_academico_id', curso.id)
    .is('deleted_at', null)
  const ninosCurso = [...new Set((matriculasCurso ?? []).map((m) => m.nino_id))]
  if (ninosCurso.length === 0) return ok({ documentos: 0, filas: 0, ninos: 0 })

  // Excluir a los que siguen matriculados activos (re-matrícula): no se les toca nada.
  const { data: activos } = await service
    .from('matriculas')
    .select('nino_id')
    .in('nino_id', ninosCurso)
    .eq('estado', 'activa')
    .is('deleted_at', null)
  const activosSet = new Set((activos ?? []).map((m) => m.nino_id))
  const objetivo = ninosCurso.filter((id) => !activosSet.has(id))
  if (objetivo.length === 0) return ok({ documentos: 0, filas: 0, ninos: 0 })

  // Recolectar rutas de los 3 tipos de documento sensible.
  const { data: ninosRows } = await service
    .from('ninos')
    .select('id, libro_familia_path')
    .in('id', objetivo)
  const librosPaths = (ninosRows ?? []).map((n) => n.libro_familia_path)

  // Sin filtro `deleted_at`: vamos a hard-delete TODAS las filas del alumni, así que también
  // recogemos los PDFs de filas soft-deleted para no dejar ficheros huérfanos en Storage.
  const { data: tutoresRows } = await service
    .from('datos_tutor')
    .select('dni_documento_path')
    .in('nino_id', objetivo)
  const dniPaths = (tutoresRows ?? []).map((tt) => tt.dni_documento_path)

  const { data: mandatosRows } = await service
    .from('mandatos_sepa')
    .select('documento_path')
    .in('nino_id', objetivo)
  const sepaPaths = (mandatosRows ?? []).map((m) => m.documento_path)

  // Borrar objetos por la Storage API (protect_delete bloquea el DELETE por SQL).
  await borrarObjetosBucket(service, BUCKET_LIBRO_FAMILIA, librosPaths).catch((e) =>
    logger.warn('purgarCurso: storage libro', e instanceof Error ? e.message : 'x')
  )
  await borrarObjetosBucket(service, BUCKET_DNI_TUTORES, dniPaths).catch((e) =>
    logger.warn('purgarCurso: storage dni', e instanceof Error ? e.message : 'x')
  )
  await borrarObjetosBucket(service, BUCKET_MANDATO_SEPA, sepaPaths).catch((e) =>
    logger.warn('purgarCurso: storage sepa', e instanceof Error ? e.message : 'x')
  )

  // === Borrado del DATO ESTRUCTURADO (G-4) ===
  // HARD delete de las filas con datos personales (los PDFs ya están borrados arriba).
  // El orden entre las 3 es libre: ninguna se referencia entre sí. `.select('id')` permite
  // contar las filas realmente eliminadas.
  const { data: cpDel } = await service
    .from('cambios_pendientes')
    .delete()
    .in('nino_id', objetivo)
    .select('id')
  const { data: sepaDel } = await service
    .from('mandatos_sepa')
    .delete()
    .in('nino_id', objetivo)
    .select('id')
  const { data: tutorDel } = await service
    .from('datos_tutor')
    .delete()
    .in('nino_id', objetivo)
    .select('id')

  // Menor: se ANULAN los datos de alta (dirección + estado civil) y la ruta del libro ya
  // borrado. NO se borra la ficha del niño (identidad core → olvido general de F11-B).
  await service
    .from('ninos')
    .update({
      libro_familia_path: null,
      direccion_calle: null,
      direccion_numero: null,
      direccion_cp: null,
      direccion_ciudad: null,
      estado_civil_familia: null,
    })
    .in('id', objetivo)

  const documentos =
    librosPaths.filter(Boolean).length +
    dniPaths.filter(Boolean).length +
    sepaPaths.filter(Boolean).length
  const filas = (cpDel?.length ?? 0) + (sepaDel?.length ?? 0) + (tutorDel?.length ?? 0)

  logger.warn(
    'purgarCurso: ejecutada',
    `curso=${curso.id} ninos=${objetivo.length} docs=${documentos} filas=${filas}`
  )
  return ok({ documentos, filas, ninos: objetivo.length })
}
