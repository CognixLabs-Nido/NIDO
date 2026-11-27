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
  // Fase 6 (`20270118120000`): los cinco datos nuevos, por `tutores_de_familia`, que aplica la regla.
  // `ve_personales` / `ve_telefono` dicen si se PUDIERON leer: falso es «no se puede leer», no «vacío».
  // Con el cliente de servicio la función no devuelve nada (no hay sesión): quedan sin leer.
  tiene_cuenta: boolean
  ve_personales: boolean
  ve_telefono: boolean
  telefono: string | null
  fecha_nacimiento: string | null
  dni_numero: string | null
  estudios: string | null
  empresa: string | null
}

/**
 * Lo que devuelve `leerTutoresDeNino`. Censo C, clase 1 (2026-11-26): `leidos` era una bandera junto a
 * `tutores`, y cuatro llamadores cogían `tutores` sin mirarla: con la lectura caída, «no hay segundo tutor»
 * (la invitación al validar no salía y la pantalla decía «guardado»), la ficha a firmar sin nombres y la
 * documentación sin tutores. Ahora, sin leer no HAY tutores que coger: el tipo obliga a mirar `leidos` antes.
 */
export type LecturaTutores =
  | {
      leidos: false
      /** Lo que contestó la base, para `LecturaFallida`. */
      error: { message: string; code?: string }
    }
  | {
      leidos: true
      familiaId: string | null
      tutores: TutorFamiliaRow[]
      /**
       * `false`: falló `tutores_de_familia`, y los `ve_personales` en falso NO son la regla de la fase 6
       * («este tutor tiene cuenta y gestiona él sus datos»), son que no se pudo leer. Sin esto las dos
       * cosas llegaban iguales (censo del 2026-11-18, «qué hacen con el no»).
       */
      personalesLeidos: boolean
    }

export async function leerTutoresDeNino(
  client: SupabaseClient<Database>,
  ninoId: string
): Promise<LecturaTutores> {
  const { data: nino, error: errorNino } = await client
    .from('ninos')
    .select('familia_id')
    .eq('id', ninoId)
    .maybeSingle()
  // `leidos: false` = una de las dos lecturas falló: los tutores vacíos NO son «no hay perfil». Quien
  // va a escribir o a decidir con ellos lo mira (el paso del tutor del alta guarda los seis campos:
  // sobre un perfil que no se leyó pisaba el nombre y vaciaba la dirección, 2026-11-12, medido).
  if (errorNino) return { leidos: false, error: errorNino }
  const familiaId = nino?.familia_id ?? null
  if (!familiaId) return { familiaId: null, tutores: [], leidos: true, personalesLeidos: true }

  const { data: rows, error: errorTutores } = await client
    .from('familia_tutores')
    .select(
      'id, rol_familia, usuario_id, email, nombre_completo, direccion_calle, direccion_numero, direccion_cp, direccion_ciudad, dni_documento_path'
    )
    .eq('familia_id', familiaId)
    .is('deleted_at', null)

  if (errorTutores) return { leidos: false, error: errorTutores }

  // Los cinco nuevos: si la función falla, ningún tutor los tiene leídos (y la pantalla lo dice).
  const { data: nuevos, error: errorNuevos } = await client.rpc('tutores_de_familia', {
    p_familia_id: familiaId,
  })
  const nuevoDe = new Map((nuevos ?? []).map((n) => [n.id, n]))

  const tutores: TutorFamiliaRow[] = (rows ?? [])
    .map((r) => {
      const n = nuevoDe.get(r.id)
      return {
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
        tiene_cuenta: r.usuario_id !== null,
        ve_personales: n?.ve_personales === true,
        ve_telefono: n?.ve_telefono === true,
        telefono: n?.telefono ?? null,
        fecha_nacimiento: n?.fecha_nacimiento ?? null,
        dni_numero: n?.dni_numero ?? null,
        estudios: n?.estudios ?? null,
        empresa: n?.empresa ?? null,
      }
    })
    // Titular primero (orden estable para la UI, independiente del orden de inserción).
    .sort((a, b) =>
      a.tipo_vinculo === b.tipo_vinculo ? 0 : a.tipo_vinculo === 'tutor_legal_principal' ? -1 : 1
    )

  return { familiaId, tutores, leidos: true, personalesLeidos: !errorNuevos }
}

/** Reexport del mapeador para quien solo necesita el sentido vínculo→rol. */
export { rolFamiliaDeVinculo }
