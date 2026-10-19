'use server'

import { revalidatePath } from 'next/cache'

import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { getCursoActivo } from '@/features/cursos/queries/get-cursos'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { toggleElegibilidadSchema, type ToggleElegibilidadInput } from '../schemas/beca-comedor'

const RUTA = '/[locale]/admin/cuotas'

/** Fecha de hoy en huso Madrid ('YYYY-MM-DD'), para `fecha_baja` al dar de baja. */
function hoyMadrid(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' })
}

/**
 * V2-2 — marca/desmarca la elegibilidad de beca comedor de un alumno en el CURSO ACTIVO.
 * Upsert por el UNIQUE (nino_id, curso_academico_id). Dar de baja (`activa=false`) sella
 * `fecha_baja` (deja de aplicar en recibos futuros; los tramos ya registrados se respetan,
 * D-P3). Reactivar limpia `fecha_baja`. `centro_id` es el DEL NIÑO (multicentro · Fase 1), con
 * admin en él; la RLS exige además `es_admin(centro_id) AND centro_de_nino(nino_id)=centro_id`.
 */
export async function toggleElegibilidad(
  input: ToggleElegibilidadInput
): Promise<ActionResult<void>> {
  const parsed = toggleElegibilidadSchema.safeParse(input)
  if (!parsed.success) return fail('admin.cuotas.beca_comedor.errors.invalid')

  const supabase = await createClient()

  // Centro DEL NIÑO (multicentro · Fase 1): admin en él, no en el centro activo.
  const { data: nino } = await supabase
    .from('ninos')
    .select('centro_id')
    .eq('id', parsed.data.nino_id)
    .maybeSingle()
  if (!nino || !(await usuarioAdminEn(supabase, nino.centro_id))) {
    return fail('admin.cuotas.beca_comedor.errors.no_autorizado')
  }
  const centroId = nino.centro_id

  const curso = await getCursoActivo(centroId)
  if (!curso) return fail('admin.cuotas.beca_comedor.errors.sin_curso')
  const { error } = await supabase.from('beca_comedor_elegibilidad').upsert(
    {
      centro_id: centroId,
      nino_id: parsed.data.nino_id,
      curso_academico_id: curso.id,
      activa: parsed.data.activa,
      fecha_baja: parsed.data.activa ? null : hoyMadrid(),
    },
    { onConflict: 'nino_id,curso_academico_id' }
  )

  if (error) {
    logger.warn('toggleElegibilidad error', error.message)
    if (error.code === '42501') return fail('admin.cuotas.beca_comedor.errors.no_autorizado')
    return fail('admin.cuotas.beca_comedor.errors.save_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok(undefined)
}
