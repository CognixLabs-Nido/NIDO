import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Gate del panel del tutor (P3c, Comportamiento 7). Devuelve el id del primer hijo
 * —del que el usuario es **tutor legal** (principal/secundario)— cuya matrícula vigente
 * NO está `'activa'`; o `null` si todas están activas / no aplica.
 *
 * Las páginas del panel (`/family`, `/family/nino/[id]`) redirigen a
 * `/{locale}/alta/{ninoId}` (layout focalizado, fuera de /family) mientras esto devuelva
 * un id: el tutor no consume el panel
 * hasta que la dirección active la matrícula.
 *
 * **Bloqueo global** (arranque ANAIA): basta un hijo no-`activa` para gatear todo el
 * panel. Sin hijos `activa` previos no hay falso bloqueo. FOLLOW-UP (docs/follow-ups.md):
 * refinar a per-hijo cuando haya hermanos en estados distintos post-lanzamiento.
 *
 * Solo cuenta vínculos `tutor_legal_*` (NO `autorizado`): el alta es acto de guardián
 * legal. Admin (sin vínculos) y autorizado → `null` → sin gate.
 */
export async function primerNinoConAltaPendiente(): Promise<string | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: vinculos } = await supabase
    .from('vinculos_familiares')
    .select('nino_id')
    .eq('usuario_id', user.id)
    .in('tipo_vinculo', ['tutor_legal_principal', 'tutor_legal_secundario'])
    .is('deleted_at', null)

  const ninoIds = (vinculos ?? []).map((v) => v.nino_id)
  if (ninoIds.length === 0) return null

  const { data: matriculas } = await supabase
    .from('matriculas')
    .select('nino_id, estado')
    .in('nino_id', ninoIds)
    .is('fecha_baja', null)
    .is('deleted_at', null)

  const noActiva = (matriculas ?? []).find((m) => m.estado !== 'activa')
  return noActiva?.nino_id ?? null
}
