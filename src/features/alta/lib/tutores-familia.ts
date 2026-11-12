import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/db'

import {
  rolFamiliaDeVinculo,
  vinculoDeRolFamilia,
  type RolFamilia,
  type TipoVinculoLegal,
} from '../schemas/alta-documentos'

/**
 * F-2b-3 — LECTURA única del perfil compartido del tutor desde `familia_tutores`
 * (identidad + dirección + DNI), resuelta por familia del niño. Sustituye el antiguo perfil
 * por-niño (tabla `datos_tutor`, eliminada en F-2b-5). Mapea `rol_familia → tipo_vinculo` para conservar el contrato
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
): Promise<{ familiaId: string | null; tutores: TutorFamiliaRow[]; leidos: boolean }> {
  const { data: nino, error: errorNino } = await client
    .from('ninos')
    .select('familia_id')
    .eq('id', ninoId)
    .maybeSingle()
  // `leidos: false` = una de las dos lecturas falló: los tutores vacíos NO son «no hay perfil». Quien
  // va a escribir o a decidir con ellos lo mira (el paso del tutor del alta guarda los seis campos:
  // sobre un perfil que no se leyó pisaba el nombre y vaciaba la dirección, 2026-11-12, medido).
  if (errorNino) return { familiaId: null, tutores: [], leidos: false }
  const familiaId = nino?.familia_id ?? null
  if (!familiaId) return { familiaId: null, tutores: [], leidos: true }

  const { data: rows, error: errorTutores } = await client
    .from('familia_tutores')
    .select(
      'id, rol_familia, usuario_id, email, nombre_completo, direccion_calle, direccion_numero, direccion_cp, direccion_ciudad, dni_documento_path'
    )
    .eq('familia_id', familiaId)
    .is('deleted_at', null)

  if (errorTutores) return { familiaId, tutores: [], leidos: false }

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

  return { familiaId, tutores, leidos: true }
}

/** Reexport del mapeador para quien solo necesita el sentido vínculo→rol. */
export { rolFamiliaDeVinculo }
