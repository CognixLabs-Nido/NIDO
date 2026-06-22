import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { TipoPersonalAula } from '@/features/profes-aulas/types'

export interface InvitacionProfePendiente {
  id: string
  email: string
  nombre_completo: string | null
  tipo_personal_aula: TipoPersonalAula | null
  aula_id: string | null
  aula_nombre: string | null
  expires_at: string
  /** Calculada en el server (la fila ya caducó) para no llamar a Date.now() en render. */
  caducada: boolean
  created_at: string
}

interface InvitacionRow {
  id: string
  email: string
  nombre_completo: string | null
  tipo_personal_aula: TipoPersonalAula | null
  aula_id: string | null
  expires_at: string
  created_at: string
  aula: { nombre: string } | null
}

/**
 * Invitaciones de profe PENDIENTES del centro (ni aceptadas ni revocadas). La
 * RLS `invitaciones_admin` (es_admin(centro_id)) restringe la lectura al admin
 * del centro. Incluye el nombre del aula (embed) para la lista de gestión. Las
 * caducadas se incluyen (la UI marca la fecha; el admin puede reenviarlas).
 */
export async function getInvitacionesProfePendientes(
  centroId: string
): Promise<InvitacionProfePendiente[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('invitaciones')
    .select(
      'id, email, nombre_completo, tipo_personal_aula, aula_id, expires_at, created_at, aula:aulas(nombre)'
    )
    .eq('centro_id', centroId)
    .eq('rol_objetivo', 'profe')
    .is('accepted_at', null)
    .is('rejected_at', null)
    .order('created_at', { ascending: false })

  const ahora = Date.now()
  const rows = (data ?? []) as unknown as InvitacionRow[]
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    nombre_completo: r.nombre_completo,
    tipo_personal_aula: r.tipo_personal_aula,
    aula_id: r.aula_id,
    aula_nombre: r.aula?.nombre ?? null,
    expires_at: r.expires_at,
    caducada: new Date(r.expires_at).getTime() < ahora,
    created_at: r.created_at,
  }))
}
