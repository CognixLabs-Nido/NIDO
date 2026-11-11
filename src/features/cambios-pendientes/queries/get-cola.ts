import 'server-only'

import { rolFamiliaDeVinculo, tipoVinculoLegalEnum } from '@/features/alta/schemas/alta-documentos'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { EntidadCambio } from '../schemas'

/** Un campo que cambia: lo guardado hoy y lo que se propone. */
export interface LineaCambio {
  campo: string
  antes: string | null
  despues: string | null
}

export interface CambioPendienteItem {
  id: string
  entidad: EntidadCambio
  ninoNombre: string
  solicitante: string
  createdAt: string
  /**
   * Antes → después de cada campo que cambia (2026-11-08, para TODAS las entradas: si unas
   * enseñaran los valores y otras solo el nombre del campo, se aprendería a aprobar las segundas
   * sin mirar). `null`: no se ha podido leer lo guardado, y la pantalla lo dice en vez de enseñar
   * un «antes» que no es.
   */
  lineas: LineaCambio[] | null
}

const CAMPOS_NINO =
  'id, familia_id, nombre, primer_apellido, segundo_apellido, fecha_nacimiento, sexo, nacionalidad, lugar_nacimiento, dni, direccion_calle, direccion_numero, direccion_cp, direccion_ciudad, direccion_provincia, estado_civil_familia, libro_familia_path'
const CAMPOS_TUTOR =
  'familia_id, rol_familia, email, nombre_completo, direccion_calle, direccion_numero, direccion_cp, direccion_ciudad, dni_documento_path'
const DATOS_TUTOR = [
  'nombre_completo',
  'email',
  'direccion_calle',
  'direccion_numero',
  'direccion_cp',
  'direccion_ciudad',
] as const

type Fila = Record<string, unknown>

const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

/** Las claves del parche que cambian, con su valor guardado al lado. */
function lineasDeParche(
  payload: Fila,
  guardado: Fila | null,
  claves: readonly string[] = Object.keys(payload)
) {
  const lineas: LineaCambio[] = []
  for (const campo of claves) {
    if (!(campo in payload)) continue
    const antes = texto(guardado?.[campo])
    const despues = texto(payload[campo])
    if (antes !== despues) lineas.push({ campo, antes, despues })
  }
  return lineas
}

/**
 * F11-G-3 — cola de cambios PENDIENTES para la cola `/admin/pendientes`, del centro de la
 * página (`centroId`): la RLS de `cambios_pendientes` deja ver los de todos los centros donde
 * el usuario es admin. Se ordena y se enriquece con el nombre del niño y del solicitante, y con
 * lo guardado hoy de cada campo que cambia, leído con la misma sesión (la Dirección lee la ficha
 * del niño y los tutores de su centro: aquí no ve nada que no pudiera ver ya).
 * Devuelve [] ante cualquier fallo de la lista (la página no debe romperse por un join).
 */
export async function listarCambiosPendientes(centroId: string): Promise<CambioPendienteItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cambios_pendientes')
    .select(
      'id, entidad, nino_id, payload, created_at, nino:ninos(nombre), solicitante:usuarios!cambios_pendientes_solicitado_por_fkey(nombre_completo)'
    )
    .eq('centro_id', centroId)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true })
  if (error) {
    logger.warn('listarCambiosPendientes', error.code ?? 'sin_codigo')
    return []
  }
  const filas = data ?? []

  // Lo guardado hoy: la ficha de cada niño de la cola y los tutores de sus familias. Si una de las
  // dos lecturas falla, sus entradas salen sin «antes» (`lineas: null`), nunca con uno inventado.
  const ninoIds = [...new Set(filas.map((r) => r.nino_id))]
  const ninos = new Map<string, Fila>()
  let ninosOk = true
  if (ninoIds.length > 0) {
    const r = await supabase.from('ninos').select(CAMPOS_NINO).in('id', ninoIds)
    if (r.error) {
      ninosOk = false
      logger.warn('listarCambiosPendientes: lo guardado del niño', r.error.code ?? 'sin_codigo')
    } else for (const n of r.data ?? []) ninos.set(n.id, n as Fila)
  }
  const familiaIds = [...new Set([...ninos.values()].map((n) => n.familia_id as string))]
  const tutores = new Map<string, Fila>()
  let tutoresOk = ninosOk
  if (ninosOk && familiaIds.length > 0) {
    const r = await supabase
      .from('familia_tutores')
      .select(CAMPOS_TUTOR)
      .in('familia_id', familiaIds)
      .is('deleted_at', null)
    if (r.error) {
      tutoresOk = false
      logger.warn('listarCambiosPendientes: lo guardado del tutor', r.error.code ?? 'sin_codigo')
    } else for (const t of r.data ?? []) tutores.set(`${t.familia_id}:${t.rol_familia}`, t as Fila)
  }

  return filas.map((r) => {
    const entidad = r.entidad as EntidadCambio
    const payload = (r.payload && typeof r.payload === 'object' ? r.payload : {}) as Fila
    const nino = ninos.get(r.nino_id) ?? null
    let lineas: LineaCambio[] | null
    if (!ninosOk || !nino) {
      lineas = null
    } else if (entidad === 'ninos_familia' || entidad === 'ninos_identidad') {
      lineas = lineasDeParche(payload, nino)
    } else if (entidad === 'ninos_libro_familia') {
      lineas = [{ campo: 'documento', antes: texto(nino.libro_familia_path), despues: 'nuevo' }]
    } else {
      const vinculo = tipoVinculoLegalEnum.safeParse(payload.tipo_vinculo)
      if (!tutoresOk || !vinculo.success) {
        lineas = null
      } else {
        const tutor = tutores.get(`${nino.familia_id}:${rolFamiliaDeVinculo(vinculo.data)}`) ?? null
        lineas =
          entidad === 'datos_tutor'
            ? // Al aprobar se escriben los seis campos (`aplicar.ts`): se enseñan los que cambian.
              lineasDeParche(payload, tutor, DATOS_TUTOR)
            : [{ campo: 'documento', antes: texto(tutor?.dni_documento_path), despues: 'nuevo' }]
      }
    }
    return {
      id: r.id,
      entidad,
      ninoNombre: r.nino?.nombre ?? '',
      solicitante: r.solicitante?.nombre_completo ?? '',
      createdAt: r.created_at,
      lineas,
    }
  })
}

/**
 * Contador de cambios pendientes para el badge del sidebar admin, del centro de la página (la
 * RLS deja ver los de todos sus centros); `head: true` + `count: 'exact'` evita traer filas.
 * 0 ante cualquier fallo.
 */
export async function contarCambiosPendientes(centroId: string): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('cambios_pendientes')
    .select('id', { count: 'exact', head: true })
    .eq('centro_id', centroId)
    .eq('estado', 'pendiente')
  if (error) {
    logger.warn('contarCambiosPendientes', error.message)
    return 0
  }
  return count ?? 0
}
