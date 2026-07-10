import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import {
  rolFamiliaDeVinculo,
  vinculoDeRolFamilia,
  type RolFamilia,
  type TipoVinculoLegal,
} from '../schemas/alta-documentos'

/**
 * F-2b-3 — LECTURA única del perfil compartido del tutor desde `familia_tutores`
 * (identidad + dirección + DNI), resuelta por familia del niño. Sustituye las lecturas
 * por `datos_tutor.nino_id`. Mapea `rol_familia → tipo_vinculo` para conservar el contrato
 * de la UI (que sigue hablando de `tutor_legal_principal/secundario`). El titular va primero.
 */
export interface TutorFamiliaRow {
  id: string
  tipo_vinculo: TipoVinculoLegal
  usuario_id: string | null
  email: string | null
  nombre_completo: string | null
  direccion_calle: string | null
  direccion_numero: string | null
  direccion_cp: string | null
  direccion_ciudad: string | null
  dni_documento_path: string | null
}

export async function leerTutoresDeNino(
  client: SupabaseClient<Database>,
  ninoId: string
): Promise<{ familiaId: string | null; tutores: TutorFamiliaRow[] }> {
  const { data: nino } = await client
    .from('ninos')
    .select('familia_id')
    .eq('id', ninoId)
    .maybeSingle()
  const familiaId = nino?.familia_id ?? null
  if (!familiaId) return { familiaId: null, tutores: [] }

  const { data: rows } = await client
    .from('familia_tutores')
    .select(
      'id, rol_familia, usuario_id, email, nombre_completo, direccion_calle, direccion_numero, direccion_cp, direccion_ciudad, dni_documento_path'
    )
    .eq('familia_id', familiaId)
    .is('deleted_at', null)

  const tutores: TutorFamiliaRow[] = (rows ?? [])
    .map((r) => ({
      id: r.id,
      tipo_vinculo: vinculoDeRolFamilia(r.rol_familia as RolFamilia),
      usuario_id: r.usuario_id,
      email: r.email,
      nombre_completo: r.nombre_completo,
      direccion_calle: r.direccion_calle,
      direccion_numero: r.direccion_numero,
      direccion_cp: r.direccion_cp,
      direccion_ciudad: r.direccion_ciudad,
      dni_documento_path: r.dni_documento_path,
    }))
    // Titular primero (orden estable para la UI, independiente del orden de inserción).
    .sort((a, b) =>
      a.tipo_vinculo === b.tipo_vinculo ? 0 : a.tipo_vinculo === 'tutor_legal_principal' ? -1 : 1
    )

  return { familiaId, tutores }
}

/** Reexport del mapeador para quien solo necesita el sentido vínculo→rol. */
export { rolFamiliaDeVinculo }
