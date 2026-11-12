import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'

import type { Database } from '@/types/db'

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
 *  - `tutor2`: la familia con un alta ya validada cuyo segundo tutor no ha entrado: con su
 *    invitación sin aceptar, o sin ninguna. La invitación sale al validar (`invitar-tutor-2.ts`);
 *    si la familia corrige su email o lo añade después de validar, la cola escribe la fila y no
 *    se invita a nadie (medido el 2026-11-04). Con «Reenviar» y «Cancelar» (20261231120000).
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
      /** El email del segundo tutor en su ficha (`familia_tutores`): a él va el reenvío. */
      email: string
      /** El de su última invitación sin aceptar, o NULL si no tiene ninguna. */
      emailInvitacion: string | null
      estado: 'sin_invitar' | 'abierta' | 'caducada' | 'rechazada'
      /** Cuándo se envió, caducó o se rechazó; NULL sin invitación. */
      desde: string | null
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

  const [sinTerminar, listasR, invitacionesR, segundosR, activasR] = await Promise.all([
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
    // El segundo tutor de cada familia, con su email y si ya tiene cuenta.
    supabase
      .from('familia_tutores')
      .select('familia_id, usuario_id, email')
      .eq('centro_id', centroId)
      .eq('rol_familia', 'segundo_tutor')
      .is('deleted_at', null),
    // Los niños con el alta ya validada: solo a ellos se les invita el segundo tutor.
    supabase
      .from('matriculas')
      .select('nino_id, nino:ninos!inner(centro_id, familia_id, deleted_at)')
      .eq('nino.centro_id', centroId)
      .is('nino.deleted_at', null)
      .eq('estado', 'activa')
      .is('deleted_at', null)
      .is('fecha_baja', null),
  ])
  if (!sinTerminar) return falla('altas_sin_terminar', undefined)
  if (listasR.error || !listasR.data) return falla('matriculas', listasR.error?.message)
  if (invitacionesR.error || !invitacionesR.data)
    return falla('invitaciones', invitacionesR.error?.message)
  if (segundosR.error || !segundosR.data) return falla('familia_tutores', segundosR.error?.message)
  if (activasR.error || !activasR.data) return falla('matriculas', activasR.error?.message)

  const idsSinTerminar = new Set(sinTerminar.map((a) => a.ninoId))
  const idsPorValidar = [...new Set(listasR.data.map((m) => m.nino_id))].filter(
    (id) => !idsSinTerminar.has(id)
  )
  // El segundo tutor que espera: sin cuenta, con email, de una familia con un niño ya validado.
  const hijosValidados = new Map<string, string[]>()
  for (const m of activasR.data) {
    const n = m.nino as unknown as { familia_id: string }
    const lista = hijosValidados.get(n.familia_id) ?? []
    if (!lista.includes(m.nino_id)) lista.push(m.nino_id)
    hijosValidados.set(n.familia_id, lista.sort())
  }
  const esperando = segundosR.data.filter(
    (t) => !t.usuario_id && t.email?.trim() && hijosValidados.has(t.familia_id)
  )
  const idsTutor2 = esperando.flatMap((t) => hijosValidados.get(t.familia_id) ?? [])
  // Si ya tiene vínculo con alguno de esos niños (entró por otro camino), no espera nada.
  const vinculosR =
    idsTutor2.length > 0
      ? await supabase
          .from('vinculos_familiares')
          .select('nino_id')
          .in('nino_id', idsTutor2)
          .eq('tipo_vinculo', 'tutor_legal_secundario')
          .is('deleted_at', null)
      : { data: [], error: null }
  if (vinculosR.error || !vinculosR.data)
    return falla('vinculos_familiares', vinculosR.error?.message)
  const conVinculo = new Set(vinculosR.data.map((v) => v.nino_id))
  // Por familia: el niño de su última invitación sin aceptar, o el primero de sus hijos validados.
  const tutor2 = new Map<
    string,
    { email: string; inv: (typeof invitacionesR.data)[number] | null }
  >()
  for (const t of esperando) {
    const hijos = hijosValidados.get(t.familia_id) ?? []
    if (hijos.some((h) => conVinculo.has(h))) continue
    const inv = invitacionesR.data.find((i) => hijos.includes(i.nino_id as string)) ?? null
    const ninoId = (inv?.nino_id as string | undefined) ?? hijos[0]
    if (!ninoId || idsSinTerminar.has(ninoId) || idsPorValidar.includes(ninoId)) continue
    tutor2.set(ninoId, { email: (t.email as string).trim(), inv })
  }

  const todos = [...idsSinTerminar, ...idsPorValidar, ...tutor2.keys()]
  if (todos.length === 0) return []

  const [ninosR, avance] = await Promise.all([
    supabase
      .from('ninos')
      .select('id, nombre, apellidos, familia_id')
      .eq('centro_id', centroId)
      .in('id', todos),
    getAvanceAltas(supabase, centroId, [...idsSinTerminar, ...idsPorValidar]),
  ])
  if (ninosR.error || !ninosR.data) return falla('ninos', ninosR.error?.message)
  if (!avance) return null

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
  for (const [id, { email, inv }] of tutor2) {
    const n = nino(id)
    if (!n) return falla('ninos', 'el niño de un segundo tutor no se lee')
    const estado = !inv
      ? 'sin_invitar'
      : inv.rejected_at
        ? 'rechazada'
        : new Date(inv.expires_at).getTime() > ahora
          ? 'abierta'
          : 'caducada'
    filas.push({
      ...sinFamilia(n),
      clase: 'tutor2',
      email,
      emailInvitacion: inv?.email ?? null,
      estado,
      desde: !inv
        ? null
        : estado === 'rechazada'
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
