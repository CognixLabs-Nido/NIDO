import 'server-only'

import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

/**
 * Estado del alta POR HIJO para el panel del tutor (P3c, Comportamiento 7; refinado a
 * per-hijo — hueco 4 del alta del 2º hijo, opción A).
 *
 * - `ninosEnAlta`: hijos —de los que el usuario es **tutor legal**— que NO tienen ninguna
 *   matrícula `'activa'` y SÍ tienen una no-`activa` (alta en curso). Su ficha muestra la
 *   tarjeta «alta en curso» con acceso al asistente.
 * - `hayNinoActivo`: al menos un hijo (tutor legal) con matrícula `'activa'`.
 *
 * Un hijo con matrícula `'activa'` + otra `'pendiente'` del curso siguiente (la crea el
 * pase de curso, `proponer-matriculas`) NO está en alta: el rollover no bloquea nada.
 *
 * El layout de `/family` solo redirige al asistente cuando NO hay ningún hijo activo y sí
 * uno en alta (primer aterrizaje del tutor recién invitado, como antes). Con un hijo
 * activo el panel se ve entero y el hermano en alta sale marcado.
 *
 * Solo cuenta vínculos `tutor_legal_*` (NO `autorizado`): el alta es acto de guardián
 * legal. Admin (sin vínculos) y autorizado → sin hijos en alta → sin gate.
 */
export interface EstadoAltaFamilia {
  ninosEnAlta: string[]
  hayNinoActivo: boolean
}

const SIN_ALTA: EstadoAltaFamilia = { ninosEnAlta: [], hayNinoActivo: false }

/**
 * Clasificación pura (testeable). `matriculas` son las vigentes (`fecha_baja` y
 * `deleted_at` nulos) de los `ninoIds`. Conserva el orden de `ninoIds`.
 */
export function clasificarAltaPorHijo(
  ninoIds: readonly string[],
  matriculas: ReadonlyArray<{ nino_id: string; estado: string }>
): EstadoAltaFamilia {
  const conActiva = new Set<string>()
  const conNoActiva = new Set<string>()
  for (const m of matriculas) {
    if (m.estado === 'activa') conActiva.add(m.nino_id)
    else conNoActiva.add(m.nino_id)
  }
  const ninosEnAlta = ninoIds.filter((id) => conNoActiva.has(id) && !conActiva.has(id))
  const hayNinoActivo = ninoIds.some((id) => conActiva.has(id))
  return { ninosEnAlta, hayNinoActivo }
}

/**
 * Debe el layout de `/family` mandar directo al asistente? Solo si no hay ningún hijo
 * activo y hay uno en alta → id del primero; si no, `null`.
 */
export function destinoGateFamilia(estado: EstadoAltaFamilia): string | null {
  if (estado.hayNinoActivo) return null
  return estado.ninosEnAlta[0] ?? null
}

/** Cacheado por request: lo leen el layout de `/family` y sus páginas. */
export const estadoAltaFamilia = cache(async (): Promise<EstadoAltaFamilia> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return SIN_ALTA

  const { data: vinculos } = await supabase
    .from('vinculos_familiares')
    .select('nino_id')
    .eq('usuario_id', user.id)
    .in('tipo_vinculo', ['tutor_legal_principal', 'tutor_legal_secundario'])
    .is('deleted_at', null)

  const ninoIds = (vinculos ?? []).map((v) => v.nino_id)
  if (ninoIds.length === 0) return SIN_ALTA

  const { data: matriculas } = await supabase
    .from('matriculas')
    .select('nino_id, estado')
    .in('nino_id', ninoIds)
    .is('fecha_baja', null)
    .is('deleted_at', null)

  return clasificarAltaPorHijo(ninoIds, matriculas ?? [])
})
