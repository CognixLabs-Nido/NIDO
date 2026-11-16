import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/db'

import type { OpcionServicio, RespuestaServicio } from '../lib/peticion'

type Client = SupabaseClient<Database>

export type PeticionLeida =
  | { ok: true; opciones: OpcionServicio[]; respuestas: RespuestaServicio[] }
  | { ok: false }

/**
 * Fase 8b — lo que el centro ofrece al niño (`servicios_alta`, con su precio) y lo que la familia
 * ha contestado (`peticion_servicio`, RLS: su tutor legal y la Dirección), con la sesión de quien
 * mira. Si una de las dos lecturas falla, `ok: false`: una lista vacía diría «el centro no ofrece
 * nada» y el paso desaparecería.
 */
export async function leerPeticionServicios(
  supabase: Client,
  ninoId: string
): Promise<PeticionLeida> {
  const [ofrecidos, contestadas] = await Promise.all([
    supabase.rpc('servicios_alta', { p_nino_id: ninoId }),
    supabase
      .from('peticion_servicio')
      .select('servicio, respuesta, concepto_id')
      .eq('nino_id', ninoId),
  ])
  if (ofrecidos.error || contestadas.error) return { ok: false }
  const opciones: OpcionServicio[] = (ofrecidos.data ?? []).flatMap((o) =>
    o.tipo_concepto === 'mensual' || o.tipo_concepto === 'diario'
      ? [
          {
            conceptoId: o.concepto_id,
            servicio: o.servicio,
            tipo: o.tipo_concepto,
            nombre: o.nombre,
            importeCentimos: o.importe_centimos,
          },
        ]
      : []
  )
  const respuestas: RespuestaServicio[] = (contestadas.data ?? []).flatMap((r) =>
    r.respuesta === 'no' || r.respuesta === 'mensual' || r.respuesta === 'dias_sueltos'
      ? [{ servicio: r.servicio, respuesta: r.respuesta, concepto_id: r.concepto_id }]
      : []
  )
  return { ok: true, opciones, respuestas }
}

/**
 * ¿El centro ofrece algún servicio que se pueda pedir en el alta? Para contar los pasos en la
 * invitación, antes de entrar (cliente de servicio: la familia aún no tiene sesión). El mismo filtro
 * que `privado.servicios_ofrecidos`, sin el precio; `peticion-servicios.rls.test.ts` compara los dos.
 */
export async function centroOfreceServicios(service: Client, centroId: string): Promise<boolean> {
  const { data, error } = await service
    .from('conceptos_cobro')
    .select('id, tipo_concepto, aplicacion')
    .eq('centro_id', centroId)
    .eq('activo', true)
    .is('deleted_at', null)
    .not('servicio', 'is', null)
    .eq('signo', 1)
    .eq('ambito', 'nino')
    .eq('tipo_valor', 'fijo')
    .in('tipo_concepto', ['mensual', 'diario'])
  if (error) throw new Error(`centroOfreceServicios: ${error.code ?? ''} ${error.message}`)
  return (data ?? []).some((c) => c.tipo_concepto === 'diario' || c.aplicacion === 'manual')
}
