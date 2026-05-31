import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'

import type { RecordatorioDestinatario } from '../types'

interface AudienciaInput {
  destinatario: RecordatorioDestinatario
  centro_id: string
  nino_id: string | null
}

/**
 * Devuelve los `usuario_id` que deben recibir un push tras crear un
 * recordatorio, según su destino. Excluye siempre al autor.
 *
 * Usa **service role client** (como el resto del pipeline push F5.5): el autor
 * no tiene RLS para leer todos los vínculos/roles del centro. La auth del
 * autor ya fue verificada por el server action que invoca esta función.
 *
 *  - `familia`   → tutores del niño con `puede_recibir_mensajes = true`
 *                  (NO profes/admin: ellos ven in-app y son los emisores).
 *  - `equipo`    → profes activos del aula del niño + admins del centro.
 *  - `direccion` → admins del centro.
 *  - `personal`  → nadie (te lo creas tú estando en la app).
 */
export async function destinatariosRecordatorio(
  rec: AudienciaInput,
  excluyendoUserId: string
): Promise<string[]> {
  if (rec.destinatario === 'personal') return []

  const supabase = await createServiceClient()
  const destinatarios = new Set<string>()

  if (rec.destinatario === 'familia' || rec.destinatario === 'equipo') {
    if (!rec.nino_id) return []

    if (rec.destinatario === 'familia') {
      // Tutores del niño con flag de recepción del canal digital.
      const { data: vinculos } = await supabase
        .from('vinculos_familiares')
        .select('usuario_id, permisos')
        .eq('nino_id', rec.nino_id)
        .is('deleted_at', null)
      for (const v of vinculos ?? []) {
        const permisos = (v.permisos as Record<string, boolean> | null) ?? {}
        if (permisos.puede_recibir_mensajes === true) destinatarios.add(v.usuario_id)
      }
    } else {
      // equipo: profes activos del aula actual del niño + admins del centro.
      const { data: matriculas } = await supabase
        .from('matriculas')
        .select('aula_id')
        .eq('nino_id', rec.nino_id)
        .is('fecha_baja', null)
        .is('deleted_at', null)
      const aulaIds = (matriculas ?? []).map((m) => m.aula_id)
      if (aulaIds.length > 0) {
        const { data: profes } = await supabase
          .from('profes_aulas')
          .select('profe_id')
          .in('aula_id', aulaIds)
          .is('fecha_fin', null)
          .is('deleted_at', null)
        for (const p of profes ?? []) destinatarios.add(p.profe_id)
      }
      for (const id of await adminsDeCentro(supabase, rec.centro_id)) destinatarios.add(id)
    }
  } else {
    // direccion → admins del centro.
    for (const id of await adminsDeCentro(supabase, rec.centro_id)) destinatarios.add(id)
  }

  destinatarios.delete(excluyendoUserId)
  return Array.from(destinatarios)
}

async function adminsDeCentro(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  centroId: string
): Promise<string[]> {
  const { data } = await supabase
    .from('roles_usuario')
    .select('usuario_id')
    .eq('centro_id', centroId)
    .eq('rol', 'admin')
    .is('deleted_at', null)
  return (data ?? []).map((r) => r.usuario_id)
}
