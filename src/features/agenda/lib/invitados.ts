import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'
import {
  ninosActivosDeAula,
  profesDeAula,
  profesDeCentro,
  tutoresDeNinos,
} from '@/shared/lib/audiencia-personas'

import type { InvitadoInput } from '../schemas/citas'
import type { TipoCita } from '../types'

/** Plan de materialización: filas a insertar en `cita_invitados` (estado='pendiente'). */
export interface InvitadosSnapshot {
  /** usuario_id de invitados internos, deduplicados y SIN el organizador. */
  internos: string[]
  /** nombre de invitados externos (texto, sin cuenta). */
  externos: string[]
}

interface ResolverArgs {
  tipo: TipoCita
  centro_id: string
  nino_id: string | null
  aula_id: string | null
  /** Solo se usa en `visita` (selección explícita de internos + externos). */
  invitados: InvitadoInput[]
  organizadorId: string
}

/**
 * Materializa la lista nominal de invitados de una cita **en el momento de
 * crearla** (snapshot, AG-02), según la matriz AG-tipos. A diferencia del
 * resolutor de F6-C —que devuelve destinatarios de un PUSH— esto produce las
 * filas a persistir en `cita_invitados`; cada `usuario_id` será una fila con
 * `estado='pendiente'`, y cada externo una fila con `nombre_externo`.
 *
 * Reusa los resolutores de bajo nivel de `@/shared/lib/audiencia-personas`
 * (extraídos de F6-C) + el nuevo `profesDeAula`. Usa **service role** porque el
 * organizador no tiene RLS para leer todos los vínculos/roles del centro (su
 * auth ya la verificó el server action; la escritura posterior sí va bajo RLS).
 *
 *  - `reunion_familia`  → TODOS los tutores/autorizados del niño (invitación
 *                         dirigida; NO se filtra por `puede_recibir_mensajes`).
 *  - `reunion_clase`    → familias del aula (broadcast-like → SÍ respeta el flag)
 *                         + profe(s) del aula.
 *  - `reunion_claustro` → todas las profes del centro.
 *  - `visita`           → la selección explícita (internos + 1 externo).
 *
 * El organizador nunca se invita a sí mismo (se excluye al final).
 */
export async function resolverInvitadosSnapshot(args: ResolverArgs): Promise<InvitadosSnapshot> {
  const supabase = await createServiceClient()
  const internos = new Set<string>()
  const externos: string[] = []

  if (args.tipo === 'reunion_familia' && args.nino_id) {
    for (const id of await tutoresDeNinos(supabase, [args.nino_id], { soloConFlag: false }))
      internos.add(id)
  } else if (args.tipo === 'reunion_clase' && args.aula_id) {
    const ninoIds = await ninosActivosDeAula(supabase, args.aula_id)
    for (const id of await tutoresDeNinos(supabase, ninoIds, { soloConFlag: true }))
      internos.add(id)
    for (const id of await profesDeAula(supabase, args.aula_id)) internos.add(id)
  } else if (args.tipo === 'reunion_claustro') {
    for (const id of await profesDeCentro(supabase, args.centro_id)) internos.add(id)
  } else if (args.tipo === 'visita') {
    for (const inv of args.invitados) {
      if (inv.tipo === 'usuario') internos.add(inv.usuario_id)
      else if (inv.tipo === 'externo') externos.push(inv.nombre_externo)
      // `grupo` no es válido en `visita` (el schema lo rechaza); se ignora por defensa.
    }
  }

  internos.delete(args.organizadorId)
  return { internos: Array.from(internos), externos }
}

interface ExplicitosArgs {
  invitados: InvitadoInput[]
  /** Contexto de la cita para expandir grupos (aula del `reunion_clase`). */
  aula_id: string | null
  centro_id: string
  organizadorId: string
}

/**
 * Expande una selección **explícita** de invitados (al editar la lista de una
 * cita ya creada, AG-02) a filas de `cita_invitados`. A diferencia de
 * `resolverInvitadosSnapshot` (dirigido por tipo), aquí se expande lo que el
 * organizador elige: individuos, grupos (con el contexto de la cita) o externos.
 * El organizador se excluye. El dedup contra los YA invitados lo hace el action.
 */
export async function resolverInvitadosExplicitos(
  args: ExplicitosArgs
): Promise<InvitadosSnapshot> {
  const supabase = await createServiceClient()
  const internos = new Set<string>()
  const externos: string[] = []

  for (const inv of args.invitados) {
    if (inv.tipo === 'usuario') {
      internos.add(inv.usuario_id)
    } else if (inv.tipo === 'externo') {
      externos.push(inv.nombre_externo)
    } else if (inv.tipo === 'grupo') {
      if (inv.grupo === 'familias_aula' && args.aula_id) {
        const ninoIds = await ninosActivosDeAula(supabase, args.aula_id)
        for (const id of await tutoresDeNinos(supabase, ninoIds, { soloConFlag: true }))
          internos.add(id)
      } else if (inv.grupo === 'profes_aula' && args.aula_id) {
        for (const id of await profesDeAula(supabase, args.aula_id)) internos.add(id)
      } else if (inv.grupo === 'profes_centro') {
        for (const id of await profesDeCentro(supabase, args.centro_id)) internos.add(id)
      }
    }
  }

  internos.delete(args.organizadorId)
  return { internos: Array.from(internos), externos }
}
