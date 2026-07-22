import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface TarifaAnioItem {
  id: string
  anioNacimiento: number
  importeCentimos: number
}

/**
 * B1-2: tarifas por año de nacimiento del centro, agrupadas por `concepto_id`. La RLS
 * admin-only (B1-0) filtra por centro. Solo se cargan para alimentar el sub-editor de los
 * conceptos con el flag `tarifa_por_anio_nacimiento` activo.
 */
export async function getTarifasConceptoAnioDeCentro(
  centroId: string
): Promise<Record<string, TarifaAnioItem[]>> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tarifa_concepto_anio')
    .select('id, concepto_id, anio_nacimiento, importe_centimos')
    .eq('centro_id', centroId)

  const porConcepto: Record<string, TarifaAnioItem[]> = {}
  for (const t of data ?? []) {
    ;(porConcepto[t.concepto_id] ??= []).push({
      id: t.id,
      anioNacimiento: t.anio_nacimiento,
      importeCentimos: t.importe_centimos,
    })
  }
  return porConcepto
}
