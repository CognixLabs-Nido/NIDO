import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { getNinosDeFamilia, type NinoDeFamiliaItem } from './get-ninos-de-familia'

export interface TutorDetalle {
  id: string
  rol_familia: 'titular' | 'segundo_tutor'
  nombre_completo: string | null
  email: string | null
  dni_documento_path: string | null
  direccion_calle: string | null
  direccion_numero: string | null
  direccion_cp: string | null
  direccion_ciudad: string | null
  usuario_id: string | null
  /** true = el tutor ya tiene cuenta (usuario_id set). */
  tiene_cuenta: boolean
}

export interface FamiliaDetalle {
  id: string
  etiqueta: string | null
  estado: 'activa' | 'inactiva'
  tutores: TutorDetalle[]
  hijos: NinoDeFamiliaItem[]
}

/**
 * F-6a — ficha de familia para Dirección: la familia (etiqueta + estado) + sus tutores
 * (perfil completo de `familia_tutores`, titular primero) + sus hijos (activos y archivados).
 * Verifica que la familia pertenece al centro del admin (`centroId`), aunque la RLS admin ya
 * lo garantiza. Devuelve null si no existe / es de otro centro. No toca RLS.
 */
export async function getFamiliaDetalle(
  familiaId: string,
  centroId: string
): Promise<FamiliaDetalle | null> {
  const supabase = await createClient()

  const { data: familia } = await supabase
    .from('familias')
    .select('id, etiqueta, deleted_at, centro_id')
    .eq('id', familiaId)
    .maybeSingle()
  if (!familia || familia.centro_id !== centroId) return null

  const [{ data: rows }, hijos] = await Promise.all([
    supabase
      .from('familia_tutores')
      .select(
        'id, rol_familia, nombre_completo, email, dni_documento_path, direccion_calle, direccion_numero, direccion_cp, direccion_ciudad, usuario_id'
      )
      .eq('familia_id', familiaId)
      .is('deleted_at', null),
    getNinosDeFamilia(familiaId),
  ])

  const tutores: TutorDetalle[] = (rows ?? [])
    .map((r) => ({
      id: r.id,
      rol_familia: r.rol_familia as 'titular' | 'segundo_tutor',
      nombre_completo: r.nombre_completo,
      email: r.email,
      dni_documento_path: r.dni_documento_path,
      direccion_calle: r.direccion_calle,
      direccion_numero: r.direccion_numero,
      direccion_cp: r.direccion_cp,
      direccion_ciudad: r.direccion_ciudad,
      usuario_id: r.usuario_id,
      tiene_cuenta: r.usuario_id !== null,
    }))
    // Titular primero (orden estable en la UI).
    .sort((a, b) => (a.rol_familia === b.rol_familia ? 0 : a.rol_familia === 'titular' ? -1 : 1))

  return {
    id: familia.id,
    etiqueta: familia.etiqueta,
    estado: familia.deleted_at ? 'inactiva' : 'activa',
    tutores,
    hijos,
  }
}
