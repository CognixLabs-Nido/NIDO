'use server'

import { revalidatePath } from 'next/cache'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  destinatariosDeAdminFamilia,
  destinatariosDeNino,
  getAutorPushInfo,
} from '@/features/push/lib/audiencia'
import { enviarPushANotificarUsuarios } from '@/features/push/lib/enviar-push'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import {
  mensajeInputSchema,
  type MensajeInput,
  type MensajeInputParsed,
} from '../schemas/messaging'
import { fail, ok, type ActionResult } from '../types'

/**
 * Envía un mensaje. El input discrimina por `kind`:
 *
 *  - `profe_familia` (legacy F5): se direcciona por `nino_id`, auto-creando
 *    la conversación si no existe (lazy). Comportamiento bit-a-bit idéntico
 *    al de F5; ver el extenso comment histórico abajo sobre el hotfix
 *    `fix/enviar-mensaje-centro-id`.
 *  - `admin_familia` (F5.6-A): se direcciona por `conversacion_id`. La
 *    conversación ya existe (la abrió el admin). Pre-check de caducidad:
 *    si `expires_at <= now()` devuelve `conversacion_caducada` sin pegar
 *    al INSERT. Race entre pre-check y INSERT: la RLS bloquea con 42501,
 *    que también mapeamos a `conversacion_caducada` (la única causa
 *    realista de 42501 cuando el caller ya tiene SELECT sobre la conv).
 *
 * Errores tipados (i18n keys de `messages.errors.*`):
 *  - `no_autorizado`: sin sesión, o conv admin_familia no visible al caller.
 *  - `nino_no_encontrado`: rama profe_familia, niño no existe o RLS lo oculta.
 *  - `sin_permisos`: rama profe_familia, RLS rechazó.
 *  - `conversacion_caducada`: rama admin_familia con expires_at en pasado
 *    (vía pre-check o vía 42501 en el INSERT).
 *  - `envio_fallo`: último recurso. Va con console.error server-side.
 */
export async function enviarMensaje(
  input: MensajeInput
): Promise<ActionResult<{ mensaje_id: string; conversacion_id: string }>> {
  const parsed = mensajeInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'messages.errors.envio_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('messages.errors.no_autorizado')

  const result = await enviarMensajeCore(supabase, userId, parsed.data)
  if (result.success) {
    revalidatePath('/[locale]/messages', 'layout')
  }
  return result
}

/**
 * Núcleo testeable: recibe el cliente Supabase y `userId` explícitos para
 * permitir que los tests inyecten `clientFor(testUser)` desde el harness RLS.
 * El wrapper público sólo wireá sesión + revalidatePath.
 */
export async function enviarMensajeCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  data: MensajeInputParsed
): Promise<ActionResult<{ mensaje_id: string; conversacion_id: string }>> {
  if (data.kind === 'profe_familia') {
    return enviarMensajeProfeFamilia(supabase, userId, data.nino_id, data.contenido)
  }
  return enviarMensajeAdminFamilia(supabase, userId, data.conversacion_id, data.contenido)
}

/**
 * Rama `profe_familia` — flujo F5 sin cambios funcionales. Auto-creación
 * lazy de la conversación a partir de `nino_id` + INSERT del mensaje + push
 * best-effort.
 *
 * Origen del `centro_id` de la conversación: se deriva del niño mediante
 * `SELECT centro_id FROM ninos WHERE id = nino_id`. Antes del hotfix
 * `fix/enviar-mensaje-centro-id` se pasaba el UUID placeholder
 * '00000000-0000-0000-0000-000000000000' confiando en que el trigger
 * BEFORE INSERT `conversaciones_set_centro_id` lo sobrescribiera. **Pero
 * el trigger solo actúa si `NEW.centro_id IS NULL`**, y un UUID válido
 * pasaba por su check sin tocarse, provocando un FK violation contra
 * `centros` en BD. La columna `centro_id` es NOT NULL en TS y BD, así que
 * derivar el valor explícitamente desde `ninos.centro_id` es la opción
 * limpia: documenta el flujo y elimina la dependencia del trigger.
 */
async function enviarMensajeProfeFamilia(
  supabase: SupabaseClient<Database>,
  userId: string,
  ninoId: string,
  contenido: string
): Promise<ActionResult<{ mensaje_id: string; conversacion_id: string }>> {
  // 1. Resolver el centro del niño. Si no existe (o RLS oculta la fila)
  //    devolvemos `nino_no_encontrado` para distinguirlo del fallo genérico.
  const { data: nino, error: ninoErr } = await supabase
    .from('ninos')
    .select('centro_id')
    .eq('id', ninoId)
    .maybeSingle()

  if (ninoErr) {
    console.error('[enviarMensaje] ninos.select falló:', ninoErr)
    return fail('messages.errors.envio_fallo')
  }
  if (!nino) {
    return fail('messages.errors.nino_no_encontrado')
  }

  // 2. Localizar o crear conversación. RLS de conversaciones.INSERT exige
  //    que el usuario sea participante. Pasamos centro_id explícito (el
  //    trigger BD también lo cubriría si fuese NULL, pero el tipo TS lo
  //    quiere NOT NULL).
  //    Tras F5.6 filtramos explícitamente por `tipo_conversacion =
  //    'profe_familia'` para que el lookup nunca pueda matchear
  //    accidentalmente con una admin_familia si en el futuro algún row
  //    raro tuviera `nino_id` poblado.
  const { data: convExistente, error: convSelErr } = await supabase
    .from('conversaciones')
    .select('id')
    .eq('nino_id', ninoId)
    .eq('tipo_conversacion', 'profe_familia')
    .maybeSingle()

  if (convSelErr) {
    console.error('[enviarMensaje] conversaciones.select falló:', convSelErr)
    return fail('messages.errors.envio_fallo')
  }

  let conversacionId = convExistente?.id ?? null

  if (!conversacionId) {
    const { data: convNueva, error: convErr } = await supabase
      .from('conversaciones')
      .insert({
        nino_id: ninoId,
        centro_id: nino.centro_id,
      })
      .select('id')
      .single()

    if (convErr || !convNueva) {
      logger.warn('enviarMensaje: crear conversación falló', convErr?.message)
      console.error('[enviarMensaje] conversaciones.insert falló:', convErr)
      if (convErr?.code === '42501') {
        return fail('messages.errors.sin_permisos')
      }
      return fail('messages.errors.envio_fallo')
    }
    conversacionId = convNueva.id
  }

  // 3. Insertar el mensaje (autor_id = auth.uid() validado por RLS WITH CHECK).
  const { data: mensaje, error: msgErr } = await supabase
    .from('mensajes')
    .insert({
      conversacion_id: conversacionId,
      autor_id: userId,
      contenido,
    })
    .select('id')
    .single()

  if (msgErr || !mensaje) {
    logger.warn('enviarMensaje: insertar mensaje falló', msgErr?.message)
    console.error('[enviarMensaje] mensajes.insert falló:', msgErr)
    if (msgErr?.code === '42501') {
      return fail('messages.errors.sin_permisos')
    }
    return fail('messages.errors.envio_fallo')
  }

  // 4. Push notifications (F5.5). Non-blocking respecto al resultado: si el
  //    envío falla, el mensaje ya está persistido y el toast del cliente
  //    sale verde igual. Sí esperamos a la promesa para que la lambda de
  //    Vercel no termine antes de que `web-push` complete los envíos.
  //    Destinatarios y datos del autor son independientes — los lanzamos en
  //    paralelo para ahorrar un round-trip a Supabase.
  try {
    const [destinatarios, autor] = await Promise.all([
      destinatariosDeNino(ninoId, userId),
      getAutorPushInfo(userId),
    ])
    if (destinatarios.length > 0) {
      const cuerpo = contenido.length > 100 ? contenido.slice(0, 99) + '…' : contenido
      await enviarPushANotificarUsuarios(destinatarios, {
        titulo: autor.nombre,
        cuerpo,
        url: `/${autor.idioma}/messages?nino=${ninoId}`,
        datos: {
          tipo: 'mensaje',
          conversacion_id: conversacionId,
          nino_id: ninoId,
        },
      })
    }
  } catch (err) {
    console.error('[enviarMensaje] push notifications falló:', err)
  }

  return ok({ mensaje_id: mensaje.id, conversacion_id: conversacionId })
}

/**
 * Rama `admin_familia` (F5.6-A) — la conversación YA existe (la abrió el
 * admin con `abrirConversacionAdminFamilia`). El caller (admin o tutor del
 * par) envía por `conversacion_id`. El trigger
 * `mensajes_reset_admin_familia_timer` renueva `expires_at` al insertar.
 */
async function enviarMensajeAdminFamilia(
  supabase: SupabaseClient<Database>,
  userId: string,
  conversacionId: string,
  contenido: string
): Promise<ActionResult<{ mensaje_id: string; conversacion_id: string }>> {
  // 1. SELECT defensivo: confirmar tipo + caducidad. Si la RLS oculta la
  //    fila (el caller no es admin/tutor del par), devolvemos `no_autorizado`.
  const { data: conv, error: convErr } = await supabase
    .from('conversaciones')
    .select('id, tipo_conversacion, expires_at, admin_id, tutor_id')
    .eq('id', conversacionId)
    .maybeSingle()

  if (convErr) {
    console.error('[enviarMensaje admin_familia] conv select falló:', convErr)
    return fail('messages.errors.envio_fallo')
  }
  if (!conv) {
    return fail('messages.errors.no_autorizado')
  }

  // Defensa en profundidad: si llega un `conversacion_id` de tipo
  // profe_familia por aquí, rechazar — el caller debería haber usado la
  // rama profe_familia por `nino_id`. Esto evita que un admin_familia
  // pueda "colarse" sobre una conv profe_familia accidentalmente.
  if (conv.tipo_conversacion !== 'admin_familia') {
    return fail('messages.errors.envio_fallo')
  }

  // 2. Pre-check de caducidad. `expires_at` es NOT NULL en admin_familia
  //    (lo enforza el CHECK de coherencia).
  const expiresAtMs = conv.expires_at ? Date.parse(conv.expires_at) : 0
  if (expiresAtMs <= Date.now()) {
    return fail('messages.errors.conversacion_caducada')
  }

  // 3. INSERT del mensaje. La RLS de mensajes valida
  //    `puede_participar_conversacion AND conversacion_activa AND autor_id = auth.uid()`.
  const { data: mensaje, error: msgErr } = await supabase
    .from('mensajes')
    .insert({
      conversacion_id: conversacionId,
      autor_id: userId,
      contenido,
    })
    .select('id')
    .single()

  if (msgErr || !mensaje) {
    logger.warn('enviarMensaje admin_familia: insertar mensaje falló', msgErr?.message)
    console.error('[enviarMensaje admin_familia] mensajes.insert falló:', msgErr)
    if (msgErr?.code === '42501') {
      // Para admin_familia, 42501 indica que la RLS bloqueó. Dado que el
      // SELECT previo demostró que el caller ES participante, la única
      // causa realista es caducidad TOCTOU entre el pre-check y el INSERT.
      // Mapeamos a `conversacion_caducada` por claridad UX.
      return fail('messages.errors.conversacion_caducada')
    }
    return fail('messages.errors.envio_fallo')
  }

  // 4. Push notifications (F5.6 — item 5). El par (admin, tutor) es 1-a-1;
  //    el destinatario es el otro miembro. Push INCONDICIONAL: la RLS ya deja
  //    participar al tutor sin mirar `puede_recibir_mensajes`, y ese flag es
  //    per-(niño, tutor) — indefinido en una conv sin niño. Best-effort: si
  //    el envío falla, el mensaje ya está persistido. `admin_id`/`tutor_id`
  //    son NOT NULL en admin_familia (CHECK de coherencia); el guard cierra
  //    el narrow de TS.
  if (conv.admin_id && conv.tutor_id) {
    try {
      const destinatarios = destinatariosDeAdminFamilia(conv.admin_id, conv.tutor_id, userId)
      if (destinatarios.length > 0) {
        const autor = await getAutorPushInfo(userId)
        const cuerpo = contenido.length > 100 ? contenido.slice(0, 99) + '…' : contenido
        await enviarPushANotificarUsuarios(destinatarios, {
          titulo: autor.nombre,
          cuerpo,
          url: `/${autor.idioma}/messages/conversacion/${conversacionId}`,
          datos: {
            tipo: 'mensaje',
            conversacion_id: conversacionId,
          },
        })
      }
    } catch (err) {
      console.error('[enviarMensaje admin_familia] push notifications falló:', err)
    }
  }

  return ok({ mensaje_id: mensaje.id, conversacion_id: conversacionId })
}
