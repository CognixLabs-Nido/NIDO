'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { registrarCambioPendiente } from '@/features/cambios-pendientes/lib/gate'

import { errorDeclararGastos } from '../lib/errores'
import { declararGastosSchema, type DeclararGastosInput } from '../schemas'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Fase 9 — cómo paga la familia los gastos de gestión, sin justificante (efectivo, o transferencia
 * con el justificante después). La base decide la puerta (`declarar_gastos_gestion`): el tutor legal
 * mientras el alta no está validada; después contesta `alta_validada` y la app lo deja en la cola
 * (`gastos_gestion`), como la tarjeta sanitaria: encola cuando la base lo dice, no por su cuenta.
 * Dirección declara siempre.
 */
export async function declararGastosGestion(
  input: DeclararGastosInput
): Promise<ActionResult<{ pendienteValidacion: boolean }>> {
  const parsed = declararGastosSchema.safeParse(input)
  if (!parsed.success) return fail('gastos_gestion.errors.invalido')
  const { nino_id, curso_academico_id, forma } = parsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('alta.errors.no_autorizado')

  const { error } = await supabase.rpc('declarar_gastos_gestion', {
    p_nino_id: nino_id,
    p_curso_academico_id: curso_academico_id,
    p_forma: forma,
  })
  if (error?.hint === 'alta_validada') {
    const r = await registrarCambioPendiente(supabase, {
      ninoId: nino_id,
      usuarioId: user.id,
      entidad: 'gastos_gestion',
      payload: { curso_academico_id, forma },
    })
    if (!r.ok) return fail(r.error)
    return ok({ pendienteValidacion: true })
  }
  if (error) return fail(errorDeclararGastos(error))
  revalidatePath('/[locale]/alta/[ninoId]', 'page')
  revalidatePath('/[locale]/admin/ninos/[id]', 'page')
  return ok({ pendienteValidacion: false })
}
