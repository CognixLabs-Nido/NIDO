import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/db'

/**
 * Deja el total del recibo en la suma de sus líneas, como hacen la app (`recalcularTotal`, después de cada línea)
 * y el motor (`generar_recibos_mes`). Para los tests que montan o tocan líneas a mano: desde 20270208120000
 * `confirmar_recibo` no confirma un borrador cuyo total no es esa suma (HINT `total_desfasado`), y un fixture que se
 * deja el total sin poner describe un estado que la app no produce. Devuelve el total que escribió.
 */
export async function totalALasLineas(
  cliente: SupabaseClient<Database>,
  reciboId: string
): Promise<number> {
  const { data: lineas, error } = await cliente
    .from('lineas_recibo')
    .select('importe_centimos')
    .eq('recibo_id', reciboId)
  if (error || !lineas) throw new Error(`totalALasLineas: leer las líneas: ${error?.message}`)
  const total = lineas.reduce((a, l) => a + l.importe_centimos, 0)
  const { data, error: e } = await cliente
    .from('recibos')
    .update({ total_centimos: total })
    .eq('id', reciboId)
    .select('id')
  if (e || data?.length !== 1)
    throw new Error(`totalALasLineas: escribir el total: ${e?.message ?? `${data?.length} filas`}`)
  return total
}
