import 'server-only'

import type { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  calcularEstadoNino,
  firmasVigentesPorFirmante,
  type FirmaEfectiva,
  type FirmanteVinculo,
} from '../lib/estado-firma'
import type { EstadoFirmaNino, PoliticaFirmantes } from '../types'

/** Una instancia por niño (recogida o medicación B2) de un listado. */
export interface InstanciaPorNino {
  id: string
  nino_id: string | null
  firmantes_requeridos: PoliticaFirmantes
}

/**
 * Estado de firma de cada instancia por niño de un listado, calculado igual que el
 * roster del detalle (`calcularEstadoNino` sobre la última decisión de cada firmante,
 * con la doble firma del niño si la exige). Los listados enseñaban solo el estado del
 * DOCUMENTO («Publicada»), que no cambia al revocar: una recogida revocada parecía
 * igual que una vigente.
 *
 * Todo con la sesión de quien lista (RLS). Una instancia sin niño visible no aparece
 * en el resultado.
 */
export async function getEstadoFirmaPorInstancia(
  supabase: Awaited<ReturnType<typeof createClient>>,
  instancias: InstanciaPorNino[]
): Promise<Map<string, EstadoFirmaNino>> {
  const out = new Map<string, EstadoFirmaNino>()
  const conNino = instancias.filter((i): i is InstanciaPorNino & { nino_id: string } =>
    Boolean(i.nino_id)
  )
  if (conNino.length === 0) return out

  const ids = conNino.map((i) => i.id)
  const ninoIds = Array.from(new Set(conNino.map((i) => i.nino_id)))
  const [{ data: ninos, error: errNinos }, { data: vinculos }, { data: firmas }] =
    await Promise.all([
      supabase.from('ninos').select('id, requiere_ambos_firmantes').in('id', ninoIds),
      supabase
        .from('vinculos_familiares')
        .select('nino_id, usuario_id, tipo_vinculo')
        .in('nino_id', ninoIds)
        .is('deleted_at', null),
      supabase
        .from('firmas_autorizacion')
        .select('autorizacion_id, nino_id, firmante_id, decision, firmado_at')
        .in('autorizacion_id', ids),
    ])
  if (errNinos) logger.warn('getEstadoFirmaPorInstancia: ninos', errNinos.message)

  const ambosPorNino = new Map((ninos ?? []).map((n) => [n.id, n.requiere_ambos_firmantes]))
  const vinculosPorNino = new Map<string, FirmanteVinculo[]>()
  for (const v of vinculos ?? []) {
    const arr = vinculosPorNino.get(v.nino_id) ?? []
    arr.push({
      firmante_id: v.usuario_id,
      firmante_nombre: '',
      rol_firmante: v.tipo_vinculo,
      es_principal: v.tipo_vinculo === 'tutor_legal_principal',
    })
    vinculosPorNino.set(v.nino_id, arr)
  }
  const firmasPorInst = new Map<string, FirmaEfectiva[]>()
  for (const f of firmas ?? []) {
    const arr = firmasPorInst.get(f.autorizacion_id) ?? []
    arr.push({ firmante_id: f.firmante_id, decision: f.decision, firmado_at: f.firmado_at })
    firmasPorInst.set(f.autorizacion_id, arr)
  }

  for (const i of conNino) {
    if (!ambosPorNino.has(i.nino_id)) continue
    const politica: PoliticaFirmantes = ambosPorNino.get(i.nino_id)
      ? 'todos_los_principales'
      : i.firmantes_requeridos
    const { estado } = calcularEstadoNino(
      politica,
      vinculosPorNino.get(i.nino_id) ?? [],
      firmasVigentesPorFirmante(firmasPorInst.get(i.id) ?? [])
    )
    out.set(i.id, estado)
  }
  return out
}
