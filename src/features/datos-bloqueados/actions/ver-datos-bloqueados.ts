'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { leerContenido } from '../lib/leer-contenido'
import {
  fail,
  ok,
  VerDatosBloqueadosSchema,
  type ActionResult,
  type ContenidoBloqueado,
} from '../types'

/**
 * Ver (o descargar) lo bloqueado de un sujeto purgado (20261205120000). Quién puede, el motivo y el
 * registro los decide `ver_datos_bloqueados`, con la sesión de quien lo pide: solo la titular, con
 * un motivo de 10 a 1000 caracteres, y cada vista o descarga deja su fila. Aquí se valida la forma
 * y se traduce el error.
 */
export async function verDatosBloqueados(
  input: unknown
): Promise<ActionResult<ContenidoBloqueado>> {
  const parsed = VerDatosBloqueadosSchema.safeParse(input)
  if (!parsed.success) return fail('datos_bloqueados.errores.motivo')
  const d = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ver_datos_bloqueados', {
    p_centro_id: d.centroId,
    p_sujeto_tipo: d.sujetoTipo,
    p_sujeto_id: d.sujetoId,
    p_motivo_tipo: d.motivoTipo,
    p_motivo: d.motivo,
    p_accion: d.accion,
  })
  if (error) {
    if (error.code === '42501') return fail('datos_bloqueados.errores.no_autorizado')
    if (error.hint === 'motivo') return fail('datos_bloqueados.errores.motivo')
    if (error.hint === 'no_bloqueado') return fail('datos_bloqueados.errores.no_bloqueado')
    logger.warn('datos bloqueados: ver_datos_bloqueados', error.code)
    return fail('datos_bloqueados.errores.fallo')
  }
  const contenido = leerContenido(data)
  if (!contenido) return fail('datos_bloqueados.errores.fallo')
  return ok(contenido)
}
