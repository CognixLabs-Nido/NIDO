import 'server-only'

import type { EstadoFirmaNino } from '../types'
import { getAutorizacionDetalle } from './get-autorizacion-detalle'
import { getAutorizacionesAdmin } from './get-autorizaciones-admin'
import type { AutorizacionItem } from '../types'

/** Un niño que aún no ha completado la firma de una instancia enviada. */
export interface NinoPendiente {
  nino_id: string
  nino_nombre: string
  estado: EstadoFirmaNino
}

/** Una instancia enviada con ≥1 niño pendiente de firma (para recordatorios). */
export interface EnvioPendiente {
  id: string
  tipo: AutorizacionItem['tipo']
  titulo: string
  created_at: string
  totalNinos: number
  firmados: number
  ninos: NinoPendiente[]
}

export interface SeguimientoEnvios {
  /** Las 10 instancias firmables más recientes (enviadas/iniciadas). */
  ultimas: AutorizacionItem[]
  /** Instancias publicadas con firmas pendientes, con el niño concreto. */
  pendientes: EnvioPendiente[]
}

/**
 * Vista de SEGUIMIENTO del admin: qué se ha enviado y a quién le falta firmar.
 * Reusa `getAutorizacionDetalle` (ya testeado) para el roster por niño en lugar de
 * recalcular el estado de firma. Acota los lookups de roster a las `maxDetalle`
 * instancias publicadas más recientes para no disparar un N+1 sin límite (un centro
 * tiene pocas instancias activas a la vez). La RLS ya filtra el alcance del rol.
 */
export async function getSeguimientoEnvios(maxDetalle = 20): Promise<SeguimientoEnvios> {
  const instancias = await getAutorizacionesAdmin()
  const ultimas = instancias.slice(0, 10)

  const candidatas = instancias.filter((a) => a.estado === 'publicada').slice(0, maxDetalle)
  const detalles = await Promise.all(candidatas.map((a) => getAutorizacionDetalle(a.id)))

  const pendientes: EnvioPendiente[] = []
  for (const d of detalles) {
    if (!d) continue
    const ninosPend = d.roster.filter((r) => r.estado === 'pendiente' || r.estado === 'parcial')
    if (ninosPend.length === 0) continue
    pendientes.push({
      id: d.id,
      tipo: d.tipo,
      titulo: d.titulo,
      created_at: d.vigencia_desde ?? '',
      totalNinos: d.roster.length,
      firmados: d.roster.filter((r) => r.estado === 'firmado').length,
      ninos: ninosPend.map((r) => ({
        nino_id: r.nino_id,
        nino_nombre: r.nino_nombre,
        estado: r.estado,
      })),
    })
  }

  return { ultimas, pendientes }
}
