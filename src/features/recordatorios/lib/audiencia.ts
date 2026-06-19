import 'server-only'

import { createServiceRoleClient } from '@/features/auth/actions/_service-role'
import {
  ninosActivosDeAula,
  ninosDeCentro,
  profesDeCentro,
  tutoresDeNinos,
} from '@/shared/lib/audiencia-personas'

import type { RecordatorioDestinatario } from '../types'

interface AudienciaInput {
  destinatario: RecordatorioDestinatario
  centro_id: string
  nino_id: string | null
  aula_id: string | null
  usuario_destinatario_id: string | null
}

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
 * Los resolutores de bajo nivel viven en `@/shared/lib/audiencia-personas`
 * (compartidos con la agenda F7b). El filtro `puede_recibir_mensajes` se aplica
 * vía `tutoresDeNinos(..., { soloConFlag: true })`: para los broadcasts el push
 * respeta el flag por niño, mientras que la visibilidad in-app (RLS) sigue solo
 * la pertenencia. Trade-off de ADR-0037.
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

  const supabase = createServiceRoleClient()
  const destinatarios = new Set<string>()

  if (rec.destinatario === 'profes_centro') {
    for (const id of await profesDeCentro(supabase, rec.centro_id)) destinatarios.add(id)
  } else if (rec.destinatario === 'familia_individual') {
    if (!rec.nino_id) return []
    for (const id of await tutoresDeNinos(supabase, [rec.nino_id], { soloConFlag: true }))
      destinatarios.add(id)
  } else if (rec.destinatario === 'familias_aula') {
    if (!rec.aula_id) return []
    const ninoIds = await ninosActivosDeAula(supabase, rec.aula_id)
    for (const id of await tutoresDeNinos(supabase, ninoIds, { soloConFlag: true }))
      destinatarios.add(id)
  } else if (rec.destinatario === 'familias_centro') {
    const ninoIds = await ninosDeCentro(supabase, rec.centro_id)
    for (const id of await tutoresDeNinos(supabase, ninoIds, { soloConFlag: true }))
      destinatarios.add(id)
  }

  destinatarios.delete(excluyendoUserId)
  return Array.from(destinatarios)
}
