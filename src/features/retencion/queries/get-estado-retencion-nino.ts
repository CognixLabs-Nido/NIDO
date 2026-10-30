import 'server-only'

import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { ANIOS_FISCAL } from '../lib/fiscal'
import {
  RETENCION_CUENTA_TUTOR_ANIOS,
  RETENCION_EXPEDIENTE_ANIOS,
  RETENCION_FIRMAS_ANIOS,
  RETENCION_OPERATIVA_ANIOS,
} from '../types'

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const Plazo = z.object({
  estado: z.string(),
  desde: Fecha.nullish(),
  hasta: Fecha.nullish(),
  motivo: z.string().nullish(),
})

const Expediente = Plazo

const EstadoSchema = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('activo') }),
  z.object({
    estado: z.enum(['baja', 'purgado']),
    baja: Fecha.nullable(),
    retenido: z.boolean(),
    puede_ver_bloqueado: z.boolean(),
    medicos: Plazo.extend({ borrado: Expediente.optional() }),
    operativa: Plazo,
    firmas: Plazo.extend({ bloqueo: Expediente.optional(), vencido: z.boolean().optional() }),
    expediente: Expediente,
    fiscal: Plazo.extend({
      motivos: z.array(z.string()).optional(),
      vencido: z.boolean().optional(),
      desde_pago: z.boolean().optional(),
    }),
    cuentas: z.array(
      Plazo.extend({
        usuario_id: z.string().uuid(),
        nombre: z.string().nullable(),
        baja_ultimo_hijo: Fecha.nullable(),
        por_otro_hijo: z.boolean(),
      })
    ),
  }),
])

export type EstadoRetencionNino = z.infer<typeof EstadoSchema>
export type PlazoRetencion = z.infer<typeof Plazo>

/**
 * Qué pasa con cada dato del niño y cuándo (`estado_retencion_nino`, 20261211120000). La BD lo
 * calcula con los mismos plazos que el cron, que se pasan aquí y en ningún otro sitio: si cambia una
 * constante, cambian a la vez la purga y lo que se enseña. NULL si quien llama no es de Dirección
 * del centro del niño o si la respuesta no tiene la forma esperada: entonces el cuadro no sale.
 */
export async function getEstadoRetencionNino(ninoId: string): Promise<EstadoRetencionNino | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('estado_retencion_nino', {
    p_nino_id: ninoId,
    p_anios_expediente: RETENCION_EXPEDIENTE_ANIOS,
    p_anios_firmas: RETENCION_FIRMAS_ANIOS,
    p_anios_operativa: RETENCION_OPERATIVA_ANIOS,
    p_anios_fiscal: ANIOS_FISCAL,
    p_anios_cuenta: RETENCION_CUENTA_TUTOR_ANIOS,
  })
  if (error) {
    if (error.code !== '42501') logger.error('estado_retencion_nino', error.message)
    return null
  }
  const parsed = EstadoSchema.safeParse(data)
  if (!parsed.success) {
    logger.error('estado_retencion_nino', 'respuesta sin la forma esperada')
    return null
  }
  return parsed.data
}
