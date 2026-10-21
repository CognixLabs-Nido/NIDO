import { usuarioResponsableEn } from '@/features/centros/contexto/roles-del-usuario'
import type { createClient } from '@/lib/supabase/server'

type Client = Awaited<ReturnType<typeof createClient>>

/**
 * El centro DEL CONCEPTO, si el usuario de la sesión es la admin de ese centro (o el superusuario).
 * Las cuotas son exclusivas de la admin (`privado.es_responsable` en la BD): una directora recibe
 * `no_autorizado`. `no_encontrado` si el concepto no existe o la RLS no deja verlo.
 */
export async function centroDelConceptoSiResponsable(
  supabase: Client,
  conceptoId: string
): Promise<{ centroId: string } | { error: 'no_encontrado' | 'no_autorizado' }> {
  const { data: concepto } = await supabase
    .from('conceptos_cobro')
    .select('centro_id')
    .eq('id', conceptoId)
    .maybeSingle()
  if (!concepto) return { error: 'no_encontrado' }
  return (await usuarioResponsableEn(supabase, concepto.centro_id))
    ? { centroId: concepto.centro_id }
    : { error: 'no_autorizado' }
}
