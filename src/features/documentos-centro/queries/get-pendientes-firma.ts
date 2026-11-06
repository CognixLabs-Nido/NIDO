import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { HijoEnCentro } from '@/features/centros/contexto/ambito-familiar'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { leerDocumentosNino, type Resultado } from '../lib/firmar-documentos'
import { agruparPendientesCentro, laFamiliaLoDebe, type PendientesCentro } from '../lib/pendientes'

/**
 * Lo pendiente de los documentos del centro, para los inicios (fase 4, 4c). Las dos lecturas van
 * con la sesión de quien mira, y la base decide quién lee qué (4a): `documentos_firma_nino` el tutor
 * legal y la Dirección del niño; `documentos_firma_centro` la Dirección del centro.
 *
 * Una lectura que falla no es «nada pendiente»: se devuelve como fallo, y la pantalla lo dice.
 */

type Client = SupabaseClient<Database>

const TUTOR_LEGAL: ReadonlySet<string> = new Set([
  'tutor_legal_principal',
  'tutor_legal_secundario',
])

export interface PorFirmarHijo {
  ninoId: string
  nombre: string
  /** Cuántos obligatorios debe; `null` si no se ha podido leer. */
  n: number | null
}

/**
 * Por cada hijo del que quien mira es tutor legal, cuántos documentos obligatorios debe. Solo los
 * hijos con algo debido o con la lectura fallida. El autorizado no firma ni lee (la base le da
 * 42501): no se le pregunta. Los hijos con el alta en curso tampoco: el alta ya se lo pide.
 */
export async function getPorFirmarFamilia(
  sesion: Client,
  hijos: readonly HijoEnCentro[],
  enAlta: readonly string[]
): Promise<PorFirmarHijo[]> {
  const propios = hijos.filter((h) => TUTOR_LEGAL.has(h.tipoVinculo) && !enAlta.includes(h.id))
  const leidos = await Promise.all(
    propios.map(async (h): Promise<PorFirmarHijo> => {
      const r = await leerDocumentosNino(sesion, h.id)
      return {
        ninoId: h.id,
        nombre: h.nombre,
        n: r.ok ? r.data.filter(laFamiliaLoDebe).length : null,
      }
    })
  )
  return leidos.filter((h) => h.n === null || h.n > 0)
}

/** Lo pendiente del centro para el inicio de Dirección, agrupado por documento y curso. */
export async function getPendientesCentro(
  sesion: Client,
  centroId: string
): Promise<Resultado<PendientesCentro>> {
  const { data, error } = await sesion.rpc('documentos_firma_centro', { p_centro_id: centroId })
  if (error) {
    logger.warn('documentos del centro: pendientes del centro', { code: error.code })
    return { ok: false, error: 'firmar_documentos.errors.leer' }
  }
  const filas = data ?? []
  const ids = [...new Set(filas.filter(laFamiliaLoDebe).map((f) => f.nino_id))]
  const nombres = new Map<string, string>()
  if (ids.length > 0) {
    const { data: ninos, error: e } = await sesion
      .from('ninos')
      .select('id, nombre, apellidos')
      .eq('centro_id', centroId)
      .in('id', ids)
    if (e) {
      logger.warn('documentos del centro: nombres de los niños', { code: e.code })
      return { ok: false, error: 'firmar_documentos.errors.leer' }
    }
    for (const n of ninos ?? []) {
      nombres.set(n.id, n.apellidos ? `${n.nombre} ${n.apellidos}` : n.nombre)
    }
  }
  return { ok: true, data: agruparPendientesCentro(filas, nombres) }
}
