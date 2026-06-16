import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { aplicarMatriculaActiva } from '@/features/matriculas/lib/matricula-activa'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

/**
 * F5B-#33 — Vínculos activos (tutor/autorizado) por niño matriculado en
 * un aula. Pensado para alimentar el picker
 * `EscribirAFamiliaAdminPicker` desde la vista de aula admin
 * (`/teacher/aula/[id]` consumido también por rol admin).
 *
 * Devuelve un Map { nino_id → array de vínculos mínimos } para que el
 * cliente acceda en O(1) por niño cuando renderiza cada `NinoAgendaCard`.
 *
 * Tipos incluidos: los tres con capacidad de mensajería F5.6-A
 * (`tutor_legal_principal`, `tutor_legal_secundario`, `autorizado`).
 * Alineamiento explícito con `getTutoresParaAdminDireccion` (PR #32) y
 * con el helper `es_tutor_en_centro` que la RLS `conversaciones_insert`
 * para `admin_familia` ya admite indistintamente.
 *
 * Filtros:
 *   - `vinculos_familiares.deleted_at IS NULL`.
 *   - `matriculas.fecha_baja IS NULL` y `matriculas.deleted_at IS NULL`.
 *   - `tipo_vinculo IN (...)` los tres tipos arriba.
 *
 * RLS: `vinculos_familiares.SELECT` ya autoriza al admin del centro vía
 * `es_admin(centro_de_nino)`. La página SSR solo ejecuta esta query
 * cuando `rol === 'admin'` para evitar IO redundante; no es defensa de
 * seguridad — la RLS lo es.
 *
 * No paraleliza las dos rondas con `Promise.all` porque la segunda
 * (vinculos) depende de `ninoIds` calculado en la primera (matriculas).
 * El `Promise.all` de la spec corresponde al CALLER (la page SSR
 * paraleliza esta query con `getAgendasAulaDelDia`).
 */
export interface VinculoTutorMin {
  usuario_id: string
  nombre_completo: string
  tipo_vinculo: 'tutor_legal_principal' | 'tutor_legal_secundario' | 'autorizado'
}

export async function getVinculosTutoresAula(
  aulaId: string
): Promise<Map<string, VinculoTutorMin[]>> {
  const supabase = await createClient()
  return getVinculosTutoresAulaCore(supabase, aulaId)
}

/**
 * Núcleo testeable: recibe el cliente Supabase. El wrapper público
 * wirea `createClient()`; los tests Vitest inyectan un fake con el
 * mismo patrón que el resto de queries del feature.
 */
export async function getVinculosTutoresAulaCore(
  supabase: SupabaseClient<Database>,
  aulaId: string
): Promise<Map<string, VinculoTutorMin[]>> {
  // 1. Niños matriculados activos en el aula.
  const { data: matriculas, error: matErr } = await aplicarMatriculaActiva(
    supabase.from('matriculas').select('nino_id').eq('aula_id', aulaId)
  )

  if (matErr) {
    logger.warn('getVinculosTutoresAula: matriculas', matErr.message)
    return new Map()
  }

  const ninoIds = (matriculas ?? []).map((m) => m.nino_id)
  if (ninoIds.length === 0) return new Map()

  // 2. Vínculos activos de tutores/autorizados sobre esos niños.
  const { data: vinculos, error: vErr } = await supabase
    .from('vinculos_familiares')
    .select(
      `
      nino_id,
      usuario_id,
      tipo_vinculo,
      usuario:usuarios!inner(nombre_completo)
      `
    )
    .in('nino_id', ninoIds)
    .in('tipo_vinculo', ['tutor_legal_principal', 'tutor_legal_secundario', 'autorizado'])
    .is('deleted_at', null)

  if (vErr) {
    logger.warn('getVinculosTutoresAula: vinculos', vErr.message)
    return new Map()
  }

  const map = new Map<string, VinculoTutorMin[]>()
  for (const v of vinculos ?? []) {
    const bucket = map.get(v.nino_id) ?? []
    bucket.push({
      usuario_id: v.usuario_id,
      nombre_completo: v.usuario?.nombre_completo ?? '',
      tipo_vinculo: v.tipo_vinculo,
    })
    map.set(v.nino_id, bucket)
  }
  return map
}
