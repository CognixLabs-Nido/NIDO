import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'

import type { Database } from '@/types/database'

import type { LineaAvance } from '../lib/avance-alta'
import { getAltasSinTerminar, type AltaSinTerminar } from './get-altas-sin-terminar'
import { getAvanceAltas } from './get-avance-alta'

type Client = SupabaseClient<Database>

interface Nino {
  ninoId: string
  nombre: string
  apellidos: string | null
}

/**
 * Una fila de «Altas en proceso» (decisión de Jose, 2026-11-04: «la lista es todo de todo», el
 * embudo entero de la directora en una pantalla). Tres clases, y cada una sale de su fuente:
 *  - `sin_terminar`: la matrícula `pendiente` (`altas_sin_terminar`, 20261209120000), con su
 *    estado, sus días y los botones que ya existen.
 *  - `por_validar`: la familia terminó (`lista`) y falta que Dirección la valide. Sin borrar.
 *  - `tutor2`: el alta ya validada cuyo segundo tutor no ha aceptado su invitación. La invitación
 *    sale al validar (`invitar-tutor-2.ts`) y hasta ahora no se veía en ninguna parte. Solo se ve:
 *    hoy no hay ningún botón para reenviarla ni cancelarla.
 */
export type AltaEnProceso =
  | (Nino & {
      clase: 'sin_terminar'
      alta: AltaSinTerminar
      avance: LineaAvance[]
      /** Días desde que cuentan (`alta.desde`); NULL con la invitación abierta. */
      dias: number | null
    })
  | (Nino & { clase: 'por_validar'; avance: LineaAvance[] })
  | (Nino & {
      clase: 'tutor2'
      email: string
      enviada: string
      estado: 'abierta' | 'caducada' | 'rechazada'
      desde: string
    })

/**
 * Todas las altas en proceso del centro, con la sesión de Dirección. NULL si alguna lectura
 * falla: la página no dice «no hay» cuando no lo sabe.
 */
export async function getAltasEnProceso(
  supabase: Client,
  centroId: string
): Promise<AltaEnProceso[] | null> {
  const falla = (fuente: string, mensaje: string | undefined) => {
    logger.warn('altas en proceso', fuente, mensaje ?? 'sin respuesta')
    return null
  }

  const [sinTerminar, listasR, invitacionesR] = await Promise.all([
    getAltasSinTerminar(supabase, centroId),
    supabase
      .from('matriculas')
      .select('nino_id, nino:ninos!inner(centro_id, deleted_at)')
      .eq('nino.centro_id', centroId)
      .is('nino.deleted_at', null)
      .eq('estado', 'lista')
      .is('deleted_at', null)
      .is('fecha_baja', null),
    supabase
      .from('invitaciones')
      .select('nino_id, email, created_at, expires_at, rejected_at')
      .eq('centro_id', centroId)
      .eq('tipo_vinculo', 'tutor_legal_secundario')
      .not('nino_id', 'is', null)
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
  ])
  if (!sinTerminar) return falla('altas_sin_terminar', undefined)
  if (listasR.error || !listasR.data) return falla('matriculas', listasR.error?.message)
  if (invitacionesR.error || !invitacionesR.data)
    return falla('invitaciones', invitacionesR.error?.message)

  const idsSinTerminar = new Set(sinTerminar.map((a) => a.ninoId))
  const idsPorValidar = [...new Set(listasR.data.map((m) => m.nino_id))].filter(
    (id) => !idsSinTerminar.has(id)
  )
  // La última invitación sin aceptar de cada niño que ya no está en alta.
  const tutor2 = new Map<string, (typeof invitacionesR.data)[number]>()
  for (const inv of invitacionesR.data) {
    const id = inv.nino_id as string
    if (idsSinTerminar.has(id) || idsPorValidar.includes(id) || tutor2.has(id)) continue
    tutor2.set(id, inv)
  }

  const todos = [...idsSinTerminar, ...idsPorValidar, ...tutor2.keys()]
  if (todos.length === 0) return []

  const [ninosR, tutoresR, avance] = await Promise.all([
    supabase
      .from('ninos')
      .select('id, nombre, apellidos, familia_id')
      .eq('centro_id', centroId)
      .in('id', todos),
    // El segundo tutor que ya entró (por otra invitación, a un hermano) no espera nada.
    supabase
      .from('familia_tutores')
      .select('familia_id, usuario_id')
      .eq('centro_id', centroId)
      .eq('rol_familia', 'segundo_tutor')
      .is('deleted_at', null),
    getAvanceAltas(supabase, centroId, [...idsSinTerminar, ...idsPorValidar]),
  ])
  if (ninosR.error || !ninosR.data) return falla('ninos', ninosR.error?.message)
  if (tutoresR.error || !tutoresR.data) return falla('familia_tutores', tutoresR.error?.message)
  if (!avance) return null

  const segundoConCuenta = new Set(
    tutoresR.data.filter((t) => t.usuario_id).map((t) => t.familia_id)
  )
  const nino = (id: string): (Nino & { familiaId: string }) | null => {
    const n = ninosR.data.find((x) => x.id === id)
    return n
      ? { ninoId: n.id, nombre: n.nombre, apellidos: n.apellidos, familiaId: n.familia_id }
      : null
  }

  const ahora = Date.now()
  const filas: AltaEnProceso[] = []
  for (const alta of sinTerminar) {
    const n = nino(alta.ninoId)
    const lineas = avance.get(alta.ninoId)
    if (!n || !lineas) return falla('ninos', 'un alta sin terminar no se lee')
    const dias = alta.desde
      ? Math.max(0, Math.floor((ahora - Date.parse(alta.desde)) / 86_400_000))
      : null
    filas.push({ ...sinFamilia(n), clase: 'sin_terminar', alta, avance: lineas, dias })
  }
  for (const id of idsPorValidar) {
    const n = nino(id)
    const lineas = avance.get(id)
    if (!n || !lineas) return falla('ninos', 'un alta por validar no se lee')
    filas.push({ ...sinFamilia(n), clase: 'por_validar', avance: lineas })
  }
  for (const [id, inv] of tutor2) {
    const n = nino(id)
    if (!n) return falla('ninos', 'el niño de una invitación no se lee')
    if (segundoConCuenta.has(n.familiaId)) continue
    const estado = inv.rejected_at
      ? 'rechazada'
      : new Date(inv.expires_at).getTime() > ahora
        ? 'abierta'
        : 'caducada'
    filas.push({
      ...sinFamilia(n),
      clase: 'tutor2',
      email: inv.email,
      enviada: inv.created_at,
      estado,
      desde:
        estado === 'rechazada'
          ? (inv.rejected_at as string)
          : estado === 'caducada'
            ? inv.expires_at
            : inv.created_at,
    })
  }
  return filas
}

function sinFamilia(n: Nino & { familiaId: string }): Nino {
  return { ninoId: n.ninoId, nombre: n.nombre, apellidos: n.apellidos }
}
