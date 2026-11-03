'use server'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  casoReabrir,
  resumenReabrirSchema,
  type AvisoReabrir,
  type ReciboQueNoSeToca,
} from '../lib/aviso-reabrir'
import {
  CLAVE_AVISO_FAILED,
  CLAVE_AVISO_INCOMPLETO,
  claveErrorReabrir,
} from '../lib/errores-reabrir'
import { leerAvisoReabrirSchema, type LeerAvisoReabrirInput } from '../schemas/remesa'

/**
 * Lo que la admin ve ANTES de reabrir una remesa: el número de familias y el importe, y quién no
 * se toca. Los números son los de `resumen_reabrir_remesa` (`20261227120000`), la misma consulta
 * con que `reabrir_remesa` comprueba que no cambiaron, así que lo que se enseña es lo que se
 * reabre. El resumen solo cuenta los devueltos y los cobrados a mano; quiénes son se lee aquí, con
 * la sesión (la RLS de Dirección), y tienen que salir tantos como cuenta el resumen: si no, el aviso
 * no se enseña (`aviso_incompleto`), porque la admin confirmaría sin ver a una familia que ya pagó
 * o ya fue al banco.
 */
export async function leerAvisoReabrir(
  input: LeerAvisoReabrirInput
): Promise<ActionResult<AvisoReabrir>> {
  const parsed = leerAvisoReabrirSchema.safeParse(input)
  if (!parsed.success) return fail('remesas.errors.invalid')
  const { remesaId } = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('resumen_reabrir_remesa', { p_remesa_id: remesaId })
  if (error) {
    const clave = claveErrorReabrir(error)
    if (clave === 'remesas.errors.reabrir_failed') {
      logger.warn('leerAvisoReabrir resumen', error.code, error.message)
      return fail(CLAVE_AVISO_FAILED)
    }
    return fail(clave)
  }
  const resumen = resumenReabrirSchema.safeParse(data)
  if (!resumen.success) {
    logger.warn('leerAvisoReabrir: el resumen no tiene la forma esperada')
    return fail(CLAVE_AVISO_FAILED)
  }

  const esperados = resumen.data.n_devueltos + resumen.data.n_cobrados
  let noSeTocan: ReciboQueNoSeToca[] = []
  if (esperados > 0) {
    const leidos = await leerNoSeTocan(supabase, remesaId)
    if (!leidos) return fail(CLAVE_AVISO_FAILED)
    if (leidos.length !== esperados) {
      logger.warn('leerAvisoReabrir: devueltos y cobrados leídos', leidos.length, 'de', esperados)
      return fail(CLAVE_AVISO_INCOMPLETO)
    }
    noSeTocan = leidos
  }

  return ok({ remesaId, resumen: resumen.data, caso: casoReabrir(resumen.data), noSeTocan })
}

type Cliente = Awaited<ReturnType<typeof createClient>>

/** Los devueltos y cobrados a mano de la remesa, por familia; `null` si falla una lectura. */
async function leerNoSeTocan(
  supabase: Cliente,
  remesaId: string
): Promise<ReciboQueNoSeToca[] | null> {
  const { data: enlaces, error: e1 } = await supabase
    .from('recibos_remesa')
    .select('recibo_id')
    .eq('remesa_id', remesaId)
  if (e1 || !enlaces) {
    logger.warn('leerAvisoReabrir enlaces', e1?.code, e1?.message)
    return null
  }
  const ids = enlaces.map((e) => e.recibo_id)
  if (ids.length === 0) return []

  const { data: recibos, error: e2 } = await supabase
    .from('recibos')
    .select('id, familia_id, total_centimos, estado')
    .in('id', ids)
    .in('estado', ['devuelto', 'cobrado_manual'])
  if (e2 || !recibos) {
    logger.warn('leerAvisoReabrir recibos', e2?.code, e2?.message)
    return null
  }

  const familiaIds = [
    ...new Set(recibos.map((r) => r.familia_id).filter((f): f is string => f != null)),
  ]
  const etiquetas = new Map<string, string>()
  if (familiaIds.length > 0) {
    const { data: familias, error: e3 } = await supabase
      .from('familias')
      .select('id, etiqueta')
      .in('id', familiaIds)
    if (e3 || !familias) {
      logger.warn('leerAvisoReabrir familias', e3?.code, e3?.message)
      return null
    }
    for (const f of familias) etiquetas.set(f.id, f.etiqueta)
  }

  return recibos
    .map((r) => ({
      id: r.id,
      familiaEtiqueta: (r.familia_id && etiquetas.get(r.familia_id)) || '',
      totalCentimos: r.total_centimos,
      estado: r.estado as ReciboQueNoSeToca['estado'],
    }))
    .sort(
      (a, b) =>
        a.familiaEtiqueta.localeCompare(b.familiaEtiqueta, 'es-ES') || a.id.localeCompare(b.id)
    )
}
