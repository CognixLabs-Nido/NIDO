'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { eurosACentimos } from '@/shared/lib/format-money'
import { logger } from '@/shared/lib/logger'

import { admiteImportePropio, admitePorcentajePropio } from '../lib/importe-propio'

const RUTA = '/[locale]/admin/cuotas'

// PR-6: el importe propio de un niño (o de una familia) se fija en su ASIGNACIÓN
// (`importe_override_centimos`), no en la línea del recibo: así se arrastra solo mes tras mes
// hasta que se cambie. PR-8: en un descuento con base se puede fijar en su lugar un porcentaje
// (`porcentaje_override_bp`), calculado sobre la base del concepto. Nunca los dos: guardar uno
// borra el otro. Los dos null lo quitan y vuelve a lo que diga el concepto.
const inputSchema = z
  .object({
    centroId: z.string().uuid(),
    conceptoId: z.string().uuid(),
    ninoId: z.string().uuid().nullable(),
    familiaId: z.string().uuid().nullable(),
    importeEuros: z.number().min(0).max(100000).nullable(),
    porcentaje: z.number().min(0).max(100).nullable().default(null),
  })
  .refine((v) => (v.ninoId == null) !== (v.familiaId == null))
  .refine((v) => v.importeEuros == null || v.porcentaje == null)

export type FijarImportePropioInput = z.input<typeof inputSchema>

export async function fijarImportePropio(
  input: FijarImportePropioInput
): Promise<ActionResult<void>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    const enPorcentaje = parsed.error.issues.some((i) => i.path[0] === 'porcentaje')
    return fail(
      enPorcentaje
        ? 'cuotas_config.errors.porcentaje_invalido'
        : 'cuotas_config.errors.importe_invalido'
    )
  }
  const { centroId, conceptoId, ninoId, familiaId, importeEuros, porcentaje } = parsed.data

  const supabase = await createClient()
  // Sin la guarda, a quien no es de Dirección la RLS le deja el UPDATE en 0 filas y oiría
  // «no está asignado» en vez de «no tienes permiso».
  if (!(await usuarioAdminEn(supabase, centroId))) return fail('cuotas_config.errors.no_autorizado')

  const { data: concepto, error: cErr } = await supabase
    .from('conceptos_cobro')
    .select('tipo_valor, tipo_concepto, signo, concepto_base_id')
    .eq('centro_id', centroId)
    .eq('id', conceptoId)
    .maybeSingle()
  if (cErr) {
    logger.warn('fijarImportePropio concepto', cErr.message)
    return fail('cuotas_config.errors.importe_failed')
  }
  if (!concepto) return fail('cuotas_config.errors.invalid')
  if (porcentaje != null && !admitePorcentajePropio(concepto))
    return fail('cuotas_config.errors.porcentaje_no_admitido')
  if (porcentaje == null && !admiteImportePropio(concepto))
    return fail('cuotas_config.errors.importe_no_admitido')

  let q = supabase
    .from('asignacion_concepto')
    .update({
      ...(importeEuros == null ? {} : { importe_override_centimos: eurosACentimos(importeEuros) }),
      // Porcentaje de la UI (%) → puntos básicos (15 % → 1500), como el catálogo.
      porcentaje_override_bp: porcentaje == null ? null : Math.round(porcentaje * 100),
    })
    .eq('centro_id', centroId)
    .eq('concepto_id', conceptoId)
    .is('deleted_at', null)
  q = ninoId ? q.eq('nino_id', ninoId) : q.eq('familia_id', familiaId!)
  const { data, error } = await q.select('id')

  if (error) {
    logger.warn('fijarImportePropio update', error.message)
    if (error.code === '42501') return fail('cuotas_config.errors.no_autorizado')
    // El concepto perdió la base entre la lectura y el guardado (trigger de la BD).
    if (error.hint === 'porcentaje_sin_base')
      return fail('cuotas_config.errors.porcentaje_no_admitido')
    return fail('cuotas_config.errors.importe_failed')
  }
  // Sin fila viva: el concepto ya no está asignado (lo quitaron en otra pestaña).
  if ((data ?? []).length === 0) return fail('cuotas_config.errors.no_asignado')

  revalidatePath(RUTA, 'page')
  return ok(undefined)
}
