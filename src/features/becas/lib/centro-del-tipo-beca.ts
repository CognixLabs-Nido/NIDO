import { usuarioResponsableEn } from '@/features/centros/contexto/roles-del-usuario'
import type { createClient } from '@/lib/supabase/server'

type Client = Awaited<ReturnType<typeof createClient>>

/**
 * ¿El usuario de la sesión es la admin del centro DEL TIPO DE BECA (o el superusuario)? Los tipos
 * de beca son cuotas, exclusivas de la admin (`privado.es_responsable` en la BD): una directora
 * recibe `no_autorizado`. `no_encontrado` si el tipo no existe o la RLS no deja verlo.
 */
export async function tipoBecaSiResponsable(
  supabase: Client,
  tipoId: string
): Promise<'ok' | 'no_encontrado' | 'no_autorizado'> {
  const { data: tipo } = await supabase
    .from('tipos_beca')
    .select('centro_id')
    .eq('id', tipoId)
    .maybeSingle()
  if (!tipo) return 'no_encontrado'
  return (await usuarioResponsableEn(supabase, tipo.centro_id)) ? 'ok' : 'no_autorizado'
}
