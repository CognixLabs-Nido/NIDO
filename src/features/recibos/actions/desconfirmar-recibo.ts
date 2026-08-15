'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { accesoModificar } from '../lib/acceso-modificar'

const RUTA = '/[locale]/admin/cuotas'

const schema = z.object({ reciboId: z.string().uuid() })

/** Traducción del motivo de bloqueo a la clave i18n que ve la directora. */
const CLAVE_BLOQUEO = {
  en_remesa: 'recibos_panel.errors.recibo_en_remesa',
  cobro_avanzado: 'recibos_panel.errors.recibo_cobrado',
  no_confirmado: 'recibos_panel.errors.no_confirmado',
} as const

/**
 * R-5 — "Modificar": devuelve un recibo CONFIRMADO a borrador para poder corregirlo con las
 * herramientas de R-3, y luego reconfirmarlo con `confirmarRecibo` (que ya existía; aquí no
 * se duplica nada). Es la vía explícita para levantar el candado, en vez de editar en
 * caliente: el recibo vuelve a ser un borrador de pleno derecho y todo lo demás sigue igual.
 *
 * SALVAGUARDA: si el recibo ya está en una REMESA CREADA, no se toca. Se comprueba aquí
 * ANTES de llamar a la RPC para poder devolver el motivo exacto sin leer mensajes de error;
 * la RPC y el trigger `congelar_si_mes_cerrado` repiten la comprobación como invariante de
 * BD (y cubren la carrera: alguien puede crear la remesa entre esta lectura y el UPDATE).
 *
 * Devuelve si el MES ha quedado reabierto: confirmar el último borrador ancla
 * `cierre_mensual` (R8), así que desconfirmar tiene que retirar el ancla o el mes se
 * quedaría marcado como cerrado con un borrador dentro.
 */
export async function desconfirmarRecibo(
  reciboId: string
): Promise<ActionResult<{ mesReabierto: boolean }>> {
  const parsed = schema.safeParse({ reciboId })
  if (!parsed.success) return fail('recibos_panel.errors.invalid')

  const supabase = await createClient()

  const { data: recibo } = await supabase
    .from('recibos')
    .select('id, estado, es_esporadico, devuelto_de_recibo_id')
    .eq('id', parsed.data.reciboId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!recibo) return fail('recibos_panel.errors.no_encontrado')
  if (recibo.es_esporadico || recibo.devuelto_de_recibo_id != null) {
    return fail('recibos_panel.errors.no_regular')
  }

  const acceso = accesoModificar(recibo.estado, await estaEnRemesa(supabase, recibo.id))
  if (!acceso.permitido) return fail(CLAVE_BLOQUEO[acceso.motivo])

  const { data, error } = await supabase.rpc('desconfirmar_recibo', {
    p_recibo_id: parsed.data.reciboId,
  })

  if (error) {
    logger.warn('desconfirmarRecibo error', error.message)
    if (error.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    // P0001 = la RPC o el trigger han rechazado el retroceso (carrera con una remesa recién
    // creada, o con un cobro registrado entre la lectura de arriba y el UPDATE).
    if (error.code === 'P0001') return fail('recibos_panel.errors.recibo_en_remesa')
    return fail('recibos_panel.errors.desconfirmar_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({ mesReabierto: data === true })
}

/**
 * ¿El recibo está en alguna remesa CREADA? Una fila en `recibos_remesa` cuya remesa siga
 * viva. `estado_remesa` solo tiene 'borrador' y 'enviada', y ambas cuentan: el enlace nace
 * al crear la remesa (`crearRemesa` inserta remesa y enlaces a la vez), que es el corte que
 * pidió Jose. Se filtra la remesa borrada para no bloquear por una que se descartó.
 */
async function estaEnRemesa(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reciboId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('recibos_remesa')
    .select('id, remesa:remesas!inner(deleted_at)')
    .eq('recibo_id', reciboId)
    .is('remesa.deleted_at', null)
    .limit(1)

  if (error) {
    // Sin certeza NO se abre el candado: es la salvaguarda de que el dinero ya salió.
    logger.warn('desconfirmarRecibo: lectura de remesas', error.message)
    return true
  }
  return (data ?? []).length > 0
}
