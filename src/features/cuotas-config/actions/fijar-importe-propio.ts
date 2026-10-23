'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { eurosACentimos } from '@/shared/lib/format-money'
import { logger } from '@/shared/lib/logger'

import { admiteImportePropio } from '../lib/importe-propio'

const RUTA = '/[locale]/admin/cuotas'

// PR-6: el importe propio de un niño (o de una familia) se fija en su ASIGNACIÓN
// (`importe_override_centimos`), no en la línea del recibo: así se arrastra solo mes tras mes
// hasta que se cambie. `importeEuros` null lo quita y vuelve al precio del concepto.
const inputSchema = z
  .object({
    centroId: z.string().uuid(),
    conceptoId: z.string().uuid(),
    ninoId: z.string().uuid().nullable(),
    familiaId: z.string().uuid().nullable(),
    importeEuros: z.number().min(0).max(100000).nullable(),
  })
  .refine((v) => (v.ninoId == null) !== (v.familiaId == null))

export type FijarImportePropioInput = z.input<typeof inputSchema>

export async function fijarImportePropio(
  input: FijarImportePropioInput
): Promise<ActionResult<void>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return fail('cuotas_config.errors.importe_invalido')
  const { centroId, conceptoId, ninoId, familiaId, importeEuros } = parsed.data

  const supabase = await createClient()
  // Sin la guarda, a quien no es de Dirección la RLS le deja el UPDATE en 0 filas y oiría
  // «no está asignado» en vez de «no tienes permiso».
  if (!(await usuarioAdminEn(supabase, centroId))) return fail('cuotas_config.errors.no_autorizado')

  const { data: concepto, error: cErr } = await supabase
    .from('conceptos_cobro')
    .select('tipo_valor, tipo_concepto')
    .eq('centro_id', centroId)
    .eq('id', conceptoId)
    .maybeSingle()
  if (cErr) {
    logger.warn('fijarImportePropio concepto', cErr.message)
    return fail('cuotas_config.errors.importe_failed')
  }
  if (!concepto) return fail('cuotas_config.errors.invalid')
  if (!admiteImportePropio(concepto)) return fail('cuotas_config.errors.importe_no_admitido')

  let q = supabase
    .from('asignacion_concepto')
    .update({
      importe_override_centimos: importeEuros == null ? null : eurosACentimos(importeEuros),
    })
    .eq('centro_id', centroId)
    .eq('concepto_id', conceptoId)
    .is('deleted_at', null)
  q = ninoId ? q.eq('nino_id', ninoId) : q.eq('familia_id', familiaId!)
  const { data, error } = await q.select('id')

  if (error) {
    logger.warn('fijarImportePropio update', error.message)
    if (error.code === '42501') return fail('cuotas_config.errors.no_autorizado')
    return fail('cuotas_config.errors.importe_failed')
  }
  // Sin fila viva: el concepto ya no está asignado (lo quitaron en otra pestaña).
  if ((data ?? []).length === 0) return fail('cuotas_config.errors.no_asignado')

  revalidatePath(RUTA, 'page')
  return ok(undefined)
}
