import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'

import type { RecordatorioDestinatario } from '../types'

interface AudienciaInput {
  destinatario: RecordatorioDestinatario
  centro_id: string
  nino_id: string | null
  aula_id: string | null
  usuario_destinatario_id: string | null
}

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>

/**
 * Devuelve los `usuario_id` que deben recibir un push tras crear un
 * recordatorio, según su destino granular (F6-C, D5). Excluye siempre al autor.
 *
 * Usa **service role client** (como el resto del pipeline push F5.5): el autor
 * no tiene RLS para leer todos los vínculos/roles del centro. La auth del autor
 * ya fue verificada por el server action que invoca esta función.
 *
 *  - `familia_individual` → tutores del `nino_id` con `puede_recibir_mensajes`.
 *  - `familias_aula`       → niños activos del `aula_id` → sus tutores con flag (dedup).
 *  - `familias_centro`     → todos los niños del centro → tutores con flag (dedup).
 *  - `profe_individual`    → `[usuario_destinatario_id]`.
 *  - `profes_centro`       → usuarios con rol profe activo del centro.
 *  - `personal`            → `[]` (te lo creas tú estando en la app).
 *
 * Nota de entrega: para los broadcasts (`familias_aula`/`familias_centro`) el
 * push respeta el flag `puede_recibir_mensajes` por niño, mientras que la
 * visibilidad in-app (RLS) sigue solo la pertenencia. Trade-off de ADR-0037.
 */
export async function expandirDestinatariosRecordatorio(
  rec: AudienciaInput,
  excluyendoUserId: string
): Promise<string[]> {
  if (rec.destinatario === 'personal') return []

  if (rec.destinatario === 'profe_individual') {
    return rec.usuario_destinatario_id && rec.usuario_destinatario_id !== excluyendoUserId
      ? [rec.usuario_destinatario_id]
      : []
  }

  const supabase = await createServiceClient()
  const destinatarios = new Set<string>()

  if (rec.destinatario === 'profes_centro') {
    for (const id of await profesDeCentro(supabase, rec.centro_id)) destinatarios.add(id)
  } else if (rec.destinatario === 'familia_individual') {
    if (!rec.nino_id) return []
    for (const id of await tutoresConFlagDeNinos(supabase, [rec.nino_id])) destinatarios.add(id)
  } else if (rec.destinatario === 'familias_aula') {
    if (!rec.aula_id) return []
    const ninoIds = await ninosActivosDeAula(supabase, rec.aula_id)
    for (const id of await tutoresConFlagDeNinos(supabase, ninoIds)) destinatarios.add(id)
  } else if (rec.destinatario === 'familias_centro') {
    const ninoIds = await ninosDeCentro(supabase, rec.centro_id)
    for (const id of await tutoresConFlagDeNinos(supabase, ninoIds)) destinatarios.add(id)
  }

  destinatarios.delete(excluyendoUserId)
  return Array.from(destinatarios)
}

/** Niños con matrícula activa en un aula. */
async function ninosActivosDeAula(supabase: ServiceClient, aulaId: string): Promise<string[]> {
  const { data } = await supabase
    .from('matriculas')
    .select('nino_id')
    .eq('aula_id', aulaId)
    .is('fecha_baja', null)
    .is('deleted_at', null)
  return (data ?? []).map((m) => m.nino_id)
}

/** Todos los niños no borrados de un centro. */
async function ninosDeCentro(supabase: ServiceClient, centroId: string): Promise<string[]> {
  const { data } = await supabase
    .from('ninos')
    .select('id')
    .eq('centro_id', centroId)
    .is('deleted_at', null)
  return (data ?? []).map((n) => n.id)
}

/**
 * Tutores/autorizados con `permisos.puede_recibir_mensajes = true` vinculados a
 * cualquiera de los `ninoIds`. Filtra el flag en JS (JSONB poco fiable con `eq`).
 */
async function tutoresConFlagDeNinos(
  supabase: ServiceClient,
  ninoIds: string[]
): Promise<string[]> {
  if (ninoIds.length === 0) return []
  const { data } = await supabase
    .from('vinculos_familiares')
    .select('usuario_id, permisos')
    .in('nino_id', ninoIds)
    .is('deleted_at', null)
  const out = new Set<string>()
  for (const v of data ?? []) {
    const permisos = (v.permisos as Record<string, boolean> | null) ?? {}
    if (permisos.puede_recibir_mensajes === true) out.add(v.usuario_id)
  }
  return Array.from(out)
}

/** Usuarios con rol profe activo en el centro. */
async function profesDeCentro(supabase: ServiceClient, centroId: string): Promise<string[]> {
  const { data } = await supabase
    .from('roles_usuario')
    .select('usuario_id')
    .eq('centro_id', centroId)
    .eq('rol', 'profe')
    .is('deleted_at', null)
  return (data ?? []).map((r) => r.usuario_id)
}
