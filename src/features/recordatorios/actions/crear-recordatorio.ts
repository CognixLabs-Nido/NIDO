'use server'

import { revalidatePath } from 'next/cache'

import type { SupabaseClient } from '@supabase/supabase-js'

import { getAutorPushInfo } from '@/features/push/lib/audiencia'
import { enviarPushANotificarUsuarios } from '@/features/push/lib/enviar-push'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { destinatariosRecordatorio } from '../lib/audiencia'
import { crearRecordatorioSchema, type CrearRecordatorioInput } from '../schemas/recordatorios'
import { fail, ok, type ActionResult } from '../types'

/**
 * Crea un recordatorio (F6). El `centro_id` se resuelve server-side:
 *  - familia/equipo: se deriva del niño (`ninos.centro_id`). El trigger BD
 *    también lo cubriría, pero lo pasamos explícito porque la columna es
 *    NOT NULL en TS y así no dependemos del trigger (cf. enviar-mensaje).
 *  - direccion/personal: se deriva del centro del usuario autenticado
 *    (`roles_usuario`). En el piloto single-centro hay exactamente uno.
 *
 * Tras el INSERT, push **inmediato** best-effort a la audiencia del destino
 * (reusa el pipeline F5.5). `personal` no notifica. Si el push falla, el
 * recordatorio ya está persistido (patrón "catch-all silencioso", #41).
 */
export async function crearRecordatorio(
  input: CrearRecordatorioInput
): Promise<ActionResult<{ recordatorio_id: string }>> {
  const parsed = crearRecordatorioSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'recordatorios.errors.creacion_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('recordatorios.errors.no_autorizado')

  const result = await crearRecordatorioCore(supabase, userId, parsed.data)
  if (result.success) {
    revalidatePath('/[locale]/reminders', 'layout')
  }
  return result
}

/**
 * Núcleo testeable: recibe cliente Supabase + `userId` explícitos. Los tests
 * unitarios inyectan un fake; los de integración usan `clientFor(testUser)`.
 * No depende de `revalidatePath`. El push va al final, best-effort.
 */
export async function crearRecordatorioCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  data: CrearRecordatorioInput
): Promise<ActionResult<{ recordatorio_id: string }>> {
  // Re-parseamos para garantizar defaults/cross-field aunque el caller invoque
  // el core directamente (los tests pasan datos ya válidos).
  const reparsed = crearRecordatorioSchema.safeParse(data)
  if (!reparsed.success) {
    return fail(reparsed.error.issues[0]?.message ?? 'recordatorios.errors.creacion_fallo')
  }
  const d = reparsed.data
  const esNinoCentrico = d.destinatario === 'familia' || d.destinatario === 'equipo'

  // 1. Resolver centro_id.
  let centroId: string
  if (esNinoCentrico) {
    const { data: nino, error: ninoErr } = await supabase
      .from('ninos')
      .select('centro_id')
      .eq('id', d.nino_id!)
      .maybeSingle()
    if (ninoErr) {
      logger.warn('crearRecordatorio: ninos.select', ninoErr.message)
      return fail('recordatorios.errors.creacion_fallo')
    }
    if (!nino) return fail('recordatorios.errors.nino_no_encontrado')
    centroId = nino.centro_id
  } else {
    const centro = await resolverCentroDelUsuario(supabase, userId)
    if (!centro) return fail('recordatorios.errors.sin_centro')
    centroId = centro
  }

  // 2. INSERT. RLS WITH CHECK autoriza según destino. `creado_por` y, en
  //    personal, `usuario_destinatario_id` se fijan al propio usuario.
  const { data: creado, error: insErr } = await supabase
    .from('recordatorios')
    .insert({
      centro_id: centroId,
      destinatario: d.destinatario,
      nino_id: esNinoCentrico ? d.nino_id! : null,
      usuario_destinatario_id: d.destinatario === 'personal' ? userId : null,
      creado_por: userId,
      titulo: d.titulo,
      descripcion: d.descripcion ?? null,
      vencimiento: d.vencimiento ?? null,
    })
    .select('id')
    .single()

  if (insErr || !creado) {
    logger.warn('crearRecordatorio: insert', insErr?.message)
    if (insErr?.code === '42501') return fail('recordatorios.errors.no_autorizado')
    return fail('recordatorios.errors.creacion_fallo')
  }

  // 3. Push inmediato best-effort (no `personal`). Esperamos la promesa para
  //    que la lambda de Vercel no termine antes de que `web-push` complete.
  try {
    const destinatarios = await destinatariosRecordatorio(
      {
        destinatario: d.destinatario,
        centro_id: centroId,
        nino_id: esNinoCentrico ? d.nino_id! : null,
      },
      userId
    )
    if (destinatarios.length > 0) {
      const autor = await getAutorPushInfo(userId)
      const cuerpo = d.titulo.length > 100 ? d.titulo.slice(0, 99) + '…' : d.titulo
      await enviarPushANotificarUsuarios(destinatarios, {
        titulo: autor.nombre,
        cuerpo,
        url: `/${autor.idioma}/reminders`,
        datos: { tipo: 'recordatorio', recordatorio_id: creado.id },
      })
    }
  } catch (err) {
    console.error('[crearRecordatorio] push notifications falló:', err)
  }

  return ok({ recordatorio_id: creado.id })
}

/**
 * Centro del usuario para recordatorios direccion/personal. Toma el primer
 * rol activo. En multi-centro (futuro) habría que pasar el centro como input;
 * en el piloto single-centro es determinista.
 */
async function resolverCentroDelUsuario(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('roles_usuario')
    .select('centro_id')
    .eq('usuario_id', userId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  return data?.centro_id ?? null
}
