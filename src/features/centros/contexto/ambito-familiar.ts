import 'server-only'

import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

/**
 * Lo que la parte familia de la app ve EN UN CENTRO (multicentro · Fase 2).
 *
 * Hasta la Fase 2 un adulto solo podía tener familia en un centro (índice único
 * `ux_familia_tutores_usuario_unico`), así que las consultas de `/family` leían «lo de mis hijos»
 * y se fiaban de la RLS. Con una familia por centro, la RLS sigue dejando ver lo de todos sus
 * hijos —es suyo— y eso mezclaría los centros. Este es el único sitio que acota la parte familia
 * a un centro: las consultas de `/family` reciben un `AmbitoFamiliar` y no se pueden llamar sin
 * él, porque solo lo construye `ambitoFamiliar`.
 *
 * Cómo filtra cada consulta con él:
 *  - Las filas con su propio `centro_id` (autorizaciones, informes, publicaciones, recibos,
 *    citas) por `ambito.centroId`: es exacto, también para lo que no cuelga de un hijo (una
 *    autorización de todo el centro, un recibo de la familia).
 *  - Las listas de hijos (el inicio, el gate del alta, los diálogos de medicación y recogida)
 *    por `ambito.hijos`.
 *
 * Decide QUÉ centro mira la familia; no da permisos. La BD sigue autorizando por RLS.
 */

type TipoVinculo = Database['public']['Enums']['tipo_vinculo']

export interface HijoEnCentro {
  id: string
  nombre: string
  apellidos: string | null
  tipoVinculo: TipoVinculo
}

declare const construidoPorElModulo: unique symbol

export interface AmbitoFamiliar {
  readonly centroId: string
  /** Hijos del usuario (vínculo vivo, cualquier tipo) cuya ficha es de este centro. */
  readonly hijos: readonly HijoEnCentro[]
  readonly [construidoPorElModulo]: true
}

/** El ámbito de la familia del usuario actual en `centroId` (una consulta por petición). */
export const ambitoFamiliar = cache(async (centroId: string): Promise<AmbitoFamiliar> => {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  const hijos: HijoEnCentro[] = []

  if (userId) {
    const { data } = await supabase
      .from('vinculos_familiares')
      .select('tipo_vinculo, nino:ninos!inner(id, nombre, apellidos, centro_id)')
      .eq('usuario_id', userId)
      .eq('nino.centro_id', centroId)
      .is('deleted_at', null)
    for (const v of data ?? []) {
      if (!v.nino || v.nino.centro_id !== centroId) continue
      hijos.push({
        id: v.nino.id,
        nombre: v.nino.nombre,
        apellidos: v.nino.apellidos,
        tipoVinculo: v.tipo_vinculo,
      })
    }
  }

  return { centroId, hijos } as unknown as AmbitoFamiliar
})

/** ¿Es una fila (de un detalle abierto por URL) del centro del ámbito? Si no, «no encontrado». */
export function esDelAmbito(ambito: AmbitoFamiliar, centroIdDeLaFila: string | null): boolean {
  return centroIdDeLaFila === ambito.centroId
}

export interface FamiliaEnCentro {
  familiaId: string
  centroId: string
}

/**
 * La familia del usuario actual en `centroId` (una por adulto y centro: índice
 * `ux_familia_tutores_usuario_centro`). `null` si no es tutor de ninguna familia de ese centro.
 * La lee con el cliente del usuario: la RLS `familia_tutores_select_tutor` le deja ver su fila.
 */
export async function familiaDelUsuarioEn(centroId: string): Promise<FamiliaEnCentro | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return null

  const { data: fila } = await supabase
    .from('familia_tutores')
    .select('familia_id')
    .eq('usuario_id', userId)
    .eq('centro_id', centroId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!fila?.familia_id) return null
  return { familiaId: fila.familia_id, centroId }
}
