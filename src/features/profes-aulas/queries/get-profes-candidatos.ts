import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

/**
 * Pool de personal candidato de un centro (D8): toda persona con rol
 * `profe` en el centro. El `GestionarPersonalDialog` excluye después a
 * quienes ya están activos en el aula concreta.
 *
 * No hay flag `es_profe` en `usuarios` — el candidato se identifica por
 * `roles_usuario.rol = 'profe'`. Admin/tutores/autorizados no aparecen
 * (no tienen ese rol). Una persona puede ser candidata a varias aulas
 * (D5: personal compartido permitido).
 */
export interface ProfeCandidato {
  id: string
  nombre_completo: string
}

export async function getProfesCandidatos(centroId: string): Promise<ProfeCandidato[]> {
  const supabase = await createClient()
  return getProfesCandidatosCore(supabase, centroId)
}

/** Núcleo testeable (cliente inyectable). */
export async function getProfesCandidatosCore(
  supabase: SupabaseClient<Database>,
  centroId: string
): Promise<ProfeCandidato[]> {
  const { data, error } = await supabase
    .from('roles_usuario')
    .select('usuario:usuarios!inner(id, nombre_completo)')
    .eq('centro_id', centroId)
    .eq('rol', 'profe')
    .is('deleted_at', null)

  if (error) {
    logger.warn('getProfesCandidatos error', error.message)
    return []
  }

  // Dedup defensivo por id (aunque roles_usuario es único por
  // usuario+centro+rol) y orden alfabético.
  const porId = new Map<string, ProfeCandidato>()
  for (const row of data ?? []) {
    if (!row.usuario) continue
    porId.set(row.usuario.id, {
      id: row.usuario.id,
      nombre_completo: row.usuario.nombre_completo,
    })
  }

  return Array.from(porId.values()).sort((a, b) =>
    a.nombre_completo.localeCompare(b.nombre_completo)
  )
}
