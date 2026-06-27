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
import { ANIOS_RETENCION_CURSO } from '../queries/get-cursos-purgables'

const purgarCursoSchema = z.object({
  cursoId: z.string().uuid(),
  /** Confirmación: el admin teclea el nombre EXACTO del curso (doble validación, decisión H). */
  confirmacionNombre: z.string().min(1),
})
export type PurgarCursoInput = z.infer<typeof purgarCursoSchema>

function fechaLimitePurga(): string {
  const hoy = new Date()
  const limite = new Date(
    Date.UTC(hoy.getUTCFullYear() - ANIOS_RETENCION_CURSO, hoy.getUTCMonth(), hoy.getUTCDate())
  )
  return limite.toISOString().slice(0, 10)
}

/**
 * F11-G-3 (decisión H) — purga semimanual de los documentos sensibles de un curso cuyo fin
 * fue hace ≥5 años (libro de familia, DNI de tutores, mandato SEPA). **Manual, sin cron**, con
 * **doble validación**: (1) el admin teclea el nombre exacto del curso; (2) el servidor
 * re-verifica el corte de 5 años. Solo afecta a niños del curso que **ya no están
 * matriculados activos** (alumni): a un niño re-matriculado no se le tocan los documentos.
 *
 * Borra los objetos por la **Storage API** (el trigger `protect_delete` bloquea el DELETE por
 * SQL) y limpia las columnas de ruta. Autoriza en app (admin del centro) y escribe con
 * **service role** (las columnas de ruta son admin-only / multi-tabla).
 */
export async function purgarCurso(
  input: PurgarCursoInput
): Promise<ActionResult<{ documentos: number; ninos: number }>> {
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
  if (ninosCurso.length === 0) return ok({ documentos: 0, ninos: 0 })

  // Excluir a los que siguen matriculados activos (re-matrícula): no se les toca nada.
  const { data: activos } = await service
    .from('matriculas')
    .select('nino_id')
    .in('nino_id', ninosCurso)
    .eq('estado', 'activa')
    .is('deleted_at', null)
  const activosSet = new Set((activos ?? []).map((m) => m.nino_id))
  const objetivo = ninosCurso.filter((id) => !activosSet.has(id))
  if (objetivo.length === 0) return ok({ documentos: 0, ninos: 0 })

  // Recolectar rutas de los 3 tipos de documento sensible.
  const { data: ninosRows } = await service
    .from('ninos')
    .select('id, libro_familia_path')
    .in('id', objetivo)
  const librosPaths = (ninosRows ?? []).map((n) => n.libro_familia_path)

  const { data: tutoresRows } = await service
    .from('datos_tutor')
    .select('dni_documento_path')
    .in('nino_id', objetivo)
    .is('deleted_at', null)
  const dniPaths = (tutoresRows ?? []).map((tt) => tt.dni_documento_path)

  const { data: mandatosRows } = await service
    .from('mandatos_sepa')
    .select('documento_path')
    .in('nino_id', objetivo)
    .is('deleted_at', null)
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

  // Limpiar las columnas de ruta (los objetos ya no existen).
  await service.from('ninos').update({ libro_familia_path: null }).in('id', objetivo)
  await service.from('datos_tutor').update({ dni_documento_path: null }).in('nino_id', objetivo)
  await service.from('mandatos_sepa').update({ documento_path: null }).in('nino_id', objetivo)

  const documentos =
    librosPaths.filter(Boolean).length +
    dniPaths.filter(Boolean).length +
    sepaPaths.filter(Boolean).length

  logger.warn(
    'purgarCurso: ejecutada',
    `curso=${curso.id} ninos=${objetivo.length} docs=${documentos}`
  )
  return ok({ documentos, ninos: objetivo.length })
}
