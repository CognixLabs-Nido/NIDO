import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { getNinosPorCentro } from '@/features/ninos/queries/get-ninos'
import type { Database } from '@/types/database'

type ModalidadCobro = Database['public']['Enums']['modalidad_cobro']
type MetodoPago = Database['public']['Enums']['metodo_pago']

export interface ConfigNinoMes {
  nino_id: string
  nombre: string
  metodo: MetodoPago | null
  /** conceptoId → modalidad fijada para ese niño/mes (solo los configurados). */
  modalidades: Record<string, ModalidadCobro>
}

// Configuración de cobro de un mes: por cada niño activo del centro, su método de pago
// y sus modalidades por concepto (asignacion_cuota). Solo lectura para la UI de B-2.
export async function getConfigMes(
  centroId: string,
  anio: number,
  mes: number
): Promise<ConfigNinoMes[]> {
  const supabase = await createClient()

  const ninos = (await getNinosPorCentro(centroId)).filter((n) => n.estado_matricula === 'activa')
  if (ninos.length === 0) return []

  const [{ data: metodos }, { data: asignaciones }] = await Promise.all([
    supabase
      .from('metodo_pago_familia')
      .select('nino_id, metodo')
      .eq('centro_id', centroId)
      .eq('anio', anio)
      .eq('mes', mes)
      .is('deleted_at', null),
    supabase
      .from('asignacion_cuota')
      .select('nino_id, concepto_id, modalidad')
      .eq('centro_id', centroId)
      .eq('anio', anio)
      .eq('mes', mes)
      .is('deleted_at', null),
  ])

  const metodoPorNino = new Map<string, MetodoPago>()
  for (const m of metodos ?? []) metodoPorNino.set(m.nino_id, m.metodo)

  const modalidadesPorNino = new Map<string, Record<string, ModalidadCobro>>()
  for (const a of asignaciones ?? []) {
    const actual = modalidadesPorNino.get(a.nino_id) ?? {}
    actual[a.concepto_id] = a.modalidad
    modalidadesPorNino.set(a.nino_id, actual)
  }

  return ninos.map((n) => ({
    nino_id: n.id,
    nombre: [n.nombre, n.apellidos].filter(Boolean).join(' '),
    metodo: metodoPorNino.get(n.id) ?? null,
    modalidades: modalidadesPorNino.get(n.id) ?? {},
  }))
}
