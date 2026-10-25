'use server'

import { revalidatePath } from 'next/cache'

import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { claveErrorEnlace } from '../lib/errores-enlace'
import { anadirARemesaSchema, type AnadirARemesaInput } from '../schemas/remesa'

/**
 * Añade recibos SEPA a una remesa en BORRADOR cuyo fichero no se ha generado (decisión del
 * responsable). Lo que manda es la BD (`recibos_remesa_validar`): la remesa sigue en borrador y
 * sin fichero, y cada recibo está libre, confirmado y es del centro, comprobado con las dos filas
 * bloqueadas. Los recibos entran todos o ninguno. Solo Dirección del centro de la remesa.
 */
export async function anadirARemesa(input: AnadirARemesaInput): Promise<ActionResult<null>> {
  const parsed = anadirARemesaSchema.safeParse(input)
  if (!parsed.success) return fail('remesas.errors.invalid')

  const supabase = await createClient()

  const { data: remesa } = await supabase
    .from('remesas')
    // `*`: lee fichero_generado_at sin romper si el despliegue llega antes que su migración.
    .select('*')
    .eq('id', parsed.data.remesaId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!remesa) return fail('remesas.errors.no_encontrada')
  // Centro DEL REGISTRO (multicentro · Fase 1): admin en él, no en el centro activo.
  if (!(await usuarioAdminEn(supabase, remesa.centro_id)))
    return fail('remesas.errors.no_autorizado')
  // Lo mismo que la BD, para dar el motivo sin escribir; la que decide es la BD.
  if (remesa.estado !== 'borrador') return fail('remesas.errors.ya_enviada')
  if (remesa.fichero_generado_at) return fail('remesas.errors.remesa_con_fichero')

  const { error } = await supabase.from('recibos_remesa').insert(
    parsed.data.reciboIds.map((reciboId) => ({
      remesa_id: remesa.id,
      recibo_id: reciboId,
      // centro_id lo deriva el trigger recibos_remesa_set_centro_id.
      centro_id: remesa.centro_id,
    }))
  )

  if (error) {
    logger.warn('anadirARemesa insert enlaces error', error.message)
    return fail(claveErrorEnlace(error, 'remesas.errors.anadir_failed'))
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok(null)
}
