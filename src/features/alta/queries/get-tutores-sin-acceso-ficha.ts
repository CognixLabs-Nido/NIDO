import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/db'

import { leerEstadoFirmaFicha } from '../lib/ficha-firmada'

export interface TutorSinAccesoFicha {
  ninoId: string
  nombre: string
  apellidos: string | null
  tipoVinculo: 'tutor_legal_principal' | 'tutor_legal_secundario'
}

/**
 * Fase 10b-2 (decisión del responsable del 2026-11-18, «Las dos, resueltas», 2): «Dirección ve en su
 * lista a los tutores legales sin ese permiso cuyo alta está esperando firma, igual que ve quién está
 * sin SIP». Firma solo el tutor legal que puede leer la ficha médica (`puede_ver_info_medica`); sin
 * él, la ficha de ese tutor no se puede firmar hasta que Dirección se lo dé.
 *
 * Esperando firma: la matrícula `pendiente`, o en `lista` sin una firma que valga. `null` si algo no
 * se lee: una lista vacía diría «todos pueden firmar».
 */
export async function getTutoresSinAccesoFicha(
  supabase: SupabaseClient<Database>,
  centroId: string
): Promise<TutorSinAccesoFicha[] | null> {
  const { data: mats, error } = await supabase
    .from('matriculas')
    .select('estado, nino_id, ninos!inner(id, nombre, apellidos, centro_id, deleted_at)')
    .in('estado', ['pendiente', 'lista'])
    .is('fecha_baja', null)
    .is('deleted_at', null)
    .eq('ninos.centro_id', centroId)
    .is('ninos.deleted_at', null)
  if (error || !mats) {
    logger.warn('getTutoresSinAccesoFicha', error?.code ?? 'sin_respuesta')
    return null
  }
  if (mats.length === 0) return []

  const ids = [...new Set(mats.map((m) => m.nino_id))]
  const { data: vinculos, error: vError } = await supabase
    .from('vinculos_familiares')
    .select('nino_id, tipo_vinculo, permisos')
    .in('nino_id', ids)
    .in('tipo_vinculo', ['tutor_legal_principal', 'tutor_legal_secundario'])
    .is('deleted_at', null)
  if (vError || !vinculos) {
    logger.warn('getTutoresSinAccesoFicha', vError?.code ?? 'sin_vinculos')
    return null
  }
  const sinAcceso = vinculos.filter(
    (v) => (v.permisos as Record<string, unknown> | null)?.puede_ver_info_medica !== true
  )
  if (sinAcceso.length === 0) return []

  const resultado: TutorSinAccesoFicha[] = []
  for (const v of sinAcceso) {
    const m = mats.find((x) => x.nino_id === v.nino_id)
    if (!m) continue
    // En `lista` solo espera firma si no hay una que valga (la firmó el otro tutor, o dejó de valer).
    if (m.estado === 'lista') {
      const estado = await leerEstadoFirmaFicha(supabase, v.nino_id)
      if (!estado.ok) return null
      if (estado.data.vigente) continue
    }
    resultado.push({
      ninoId: m.ninos.id,
      nombre: m.ninos.nombre,
      apellidos: m.ninos.apellidos,
      tipoVinculo: v.tipo_vinculo as TutorSinAccesoFicha['tipoVinculo'],
    })
  }
  return resultado.sort((a, b) =>
    `${a.nombre} ${a.apellidos ?? ''}`.localeCompare(`${b.nombre} ${b.apellidos ?? ''}`, 'es')
  )
}
