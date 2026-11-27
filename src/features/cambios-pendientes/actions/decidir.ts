'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'
import {
  aplicarCambioPendiente,
  type CambioRow,
  decidirMandato,
  descartarCambioPendiente,
  RutaDocumentoInvalidaError,
} from '../lib/aplicar'
import { payloadMandatoSepaSchema } from '../schemas'
import {
  decidirInvitacionTutor2,
  invitarTutor2SiCambioElEmail,
  type InvitacionAlAprobar,
} from '../lib/invitar-tutor2-al-aprobar'
import { escrituraSecundariaFallida } from '@/shared/lib/tras-escritura'

const idSchema = z.string().uuid()

/** Lo que devuelve `reclamar_cambio_pendiente` (20270209120000). */
type Reserva =
  | {
      estado: 'reservado'
      fila: CambioRow & {
        id: string
        aplicando_desde: string
        invita_tutor2: boolean | null
      }
    }
  | { estado: 'aplicandose'; desde: string }
  | { estado: 'no_pendiente' }

/** Los motivos de «falló al aplicar» (`fallo_aplicar_motivo`): un código, sin datos personales. */
export type MotivoFalloAplicar =
  | 'lectura_tutor2'
  | 'decision_tutor2'
  | 'aplicar'
  | 'ruta_invalida'
  | 'rechazar_mandato'

/**
 * Reserva el cambio sin sacarlo de la cola (B2, 2026-11-27): la fila sigue 'pendiente' y lleva
 * `aplicando_desde`. La reserva vale 2 minutos contra el `now()` de la base; con otra vigente, contesta
 * `aplicandose`. Lanza si la llamada falla: sin reserva no se toca nada.
 */
async function reservar(supabase: Sesion, id: string): Promise<Reserva> {
  const { data, error } = await supabase.rpc('reclamar_cambio_pendiente', { p_cambio: id })
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data as unknown as Reserva
}

/**
 * «Falló al aplicar», en UNA escritura: el motivo y la reserva quitada, sobre la reserva propia. Si esta
 * escritura falla también, la fila sigue pendiente y reservada: a los 2 minutos se vuelve a poder aprobar
 * («no consta que se haya aplicado»). En ningún caso sale de la cola. Ese segundo fallo va a Sentry.
 */
async function marcarFallo(
  supabase: Sesion,
  id: string,
  desde: string,
  motivo: MotivoFalloAplicar
): Promise<void> {
  const { error } = await supabase.rpc('marcar_fallo_cambio_pendiente', {
    p_cambio: id,
    p_desde: desde,
    p_motivo: motivo,
  })
  if (error) escrituraSecundariaFallida('cola: marcar «falló al aplicar»', error)
}

function falloDeReserva(r: Exclude<Reserva, { estado: 'reservado' }>) {
  return r.estado === 'aplicandose'
    ? fail('admin.pendientes.errors.aplicandose')
    : fail('admin.pendientes.errors.no_pendiente')
}

type Sesion = Awaited<ReturnType<typeof createClient>>

/**
 * F11-G-3 (decisión J) — la dirección APRUEBA un cambio pendiente. Desde B2 (2026-11-27, Jose: «un cambio
 * NUNCA sale de la cola si no se aplicó»), en este orden:
 *
 *   1. Lo reserva (`reclamar_cambio_pendiente`): la fila sigue 'pendiente'. La RLS
 *      `cambios_pendientes_update` (`es_admin`) es la puerta: a quien no es Dirección la base no le
 *      reserva nada.
 *   2. Si el cambio es de los datos del segundo tutor y la decisión de invitarle no está tomada, la toma
 *      (su email nuevo frente al de antes) y la GUARDA en la fila (`invita_tutor2`) antes de aplicar. Un
 *      reintento la lee: tras aplicar, el email de antes ya es el nuevo y recalcularla no invitaría.
 *   3. Aplica con la sesión de la directora (audit con SU uid); el service role solo borra en Storage.
 *   4. Invita al segundo tutor si se decidió (antes de marcar: si el proceso muere entre medias, el
 *      reintento vuelve a invitar, que es inofensivo; al revés, la invitación se perdería).
 *   5. Marca 'aprobado' y quita la reserva, sobre la reserva propia.
 *
 * Si algo de 2 o 3 falla, una escritura deja «falló al aplicar» con su motivo y la fila sigue pendiente
 * para reintentar (`marcarFallo`). Reaplicar cada entidad es inofensivo (medido antes de construir,
 * `aplicar-cambio-dos-veces.rls.test.ts`).
 */
export async function aprobarCambio(
  cambioId: string
): Promise<ActionResult<{ id: string; tutor2: InvitacionAlAprobar }>> {
  const parsed = idSchema.safeParse(cambioId)
  if (!parsed.success) return fail('admin.pendientes.errors.invalido')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('alta.errors.no_autorizado')

  let reserva: Reserva
  try {
    reserva = await reservar(supabase, parsed.data)
  } catch (e) {
    logger.warn('aprobarCambio: reservar', e instanceof Error ? e.message : 'desconocido')
    return fail('admin.pendientes.errors.decidir')
  }
  if (reserva.estado !== 'reservado') return falloDeReserva(reserva)
  const fila = reserva.fila
  const desde = fila.aplicando_desde

  const service = createServiceRoleClient()

  // 2. La decisión de invitar al segundo tutor, una sola vez y guardada antes de aplicar.
  let invita = fila.invita_tutor2 === true
  if (fila.invita_tutor2 === null) {
    let decision
    try {
      decision = await decidirInvitacionTutor2(service, fila)
    } catch (e) {
      logger.warn(
        'aprobarCambio: leer el segundo tutor',
        e instanceof Error ? e.message : 'desconocido'
      )
      await marcarFallo(supabase, fila.id, desde, 'lectura_tutor2')
      return fail('admin.pendientes.errors.aplicar')
    }
    if (decision.aplica) {
      const { data: guardada, error } = await supabase
        .from('cambios_pendientes')
        .update({ invita_tutor2: decision.invita })
        .eq('id', fila.id)
        .eq('aplicando_desde', desde)
        .is('invita_tutor2', null)
        .select('id')
        .maybeSingle()
      if (error || !guardada) {
        logger.warn(
          'aprobarCambio: guardar la decisión del segundo tutor',
          error?.code ?? '0 filas'
        )
        await marcarFallo(supabase, fila.id, desde, 'decision_tutor2')
        return fail('admin.pendientes.errors.aplicar')
      }
      invita = decision.invita
    }
  }

  // 3. Aplicar.
  try {
    await aplicarCambioPendiente(supabase, service, fila)
  } catch (e) {
    logger.warn('aprobarCambio: aplicar', e instanceof Error ? e.message : 'desconocido')
    // R1b: la ruta del documento no es del niño de la fila → no se escribe ni se reintentará.
    if (e instanceof RutaDocumentoInvalidaError) {
      await marcarFallo(supabase, fila.id, desde, 'ruta_invalida')
      return fail('admin.pendientes.errors.ruta_invalida')
    }
    await marcarFallo(supabase, fila.id, desde, 'aplicar')
    return fail('admin.pendientes.errors.aplicar')
  }

  // 4. Aplicado: lo que pase con la invitación ya no lo deshace.
  const tutor2 = await invitarTutor2SiCambioElEmail(service, fila, invita, user.id)

  // 5. Marcar 'aprobado' y quitar la reserva. El mandato ya lo cerró la base al decidirlo
  // (`decidir_mandato_propuesto`, `WHERE estado = 'pendiente'`): ahí solo queda quitar la reserva.
  const marca =
    fila.entidad === 'mandato_sepa'
      ? await supabase
          .from('cambios_pendientes')
          .update({ aplicando_desde: null })
          .eq('id', fila.id)
          .eq('aplicando_desde', desde)
      : await supabase
          .from('cambios_pendientes')
          .update({
            estado: 'aprobado',
            revisado_por: user.id,
            decided_at: new Date().toISOString(),
            aplicando_desde: null,
          })
          .eq('id', fila.id)
          .eq('estado', 'pendiente')
          .eq('aplicando_desde', desde)
  if (marca.error && fila.entidad === 'mandato_sepa') {
    // La base ya cerró la entrada al decidir el mandato: la reserva en una fila cerrada no la ve nadie.
    escrituraSecundariaFallida('aprobarCambio: quitar la reserva del mandato', marca.error)
  } else if (marca.error) {
    // Aplicado y sin cerrar: la fila sigue pendiente y reservada. A los 2 minutos sale «no consta que
    // se haya aplicado» y aprobarlo otra vez reaplica, que es inofensivo. Se dice tal cual.
    escrituraSecundariaFallida('aprobarCambio: marcar aprobado', marca.error)
    return fail('admin.pendientes.errors.aplicado_sin_cerrar')
  }

  revalidatePath('/[locale]/admin/pendientes', 'page')
  if (tutor2 !== 'no_aplica') revalidatePath('/[locale]/admin/altas', 'page')
  return ok({ id: fila.id, tutor2 })
}

/**
 * F11-G-3 — la dirección RECHAZA un cambio pendiente: la fila pasa a 'rechazado' (el dato queda como
 * estaba) y se descartan los objetos staged de documentos subidos a la espera de validación. Desde B2
 * (2026-11-27), con la misma reserva que aprobar: no se rechaza un cambio que otra aprobación está
 * aplicando, y si algo falla la fila no sale de la cola.
 *
 * El mandato propuesto no es un fichero que se descarta: lo marca 'rechazado' la base, que en la misma
 * llamada cierra la entrada (`decidir_mandato_propuesto`). Si falla, la entrada sigue pendiente con
 * «falló al aplicar»: ya no hay una entrada rechazada con su mandato aún 'propuesto' (el doble fallo que
 * el censo C mandó a B2).
 */
export async function rechazarCambio(cambioId: string): Promise<ActionResult<{ id: string }>> {
  const parsed = idSchema.safeParse(cambioId)
  if (!parsed.success) return fail('admin.pendientes.errors.invalido')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('alta.errors.no_autorizado')

  let reserva: Reserva
  try {
    reserva = await reservar(supabase, parsed.data)
  } catch (e) {
    logger.warn('rechazarCambio: reservar', e instanceof Error ? e.message : 'desconocido')
    return fail('admin.pendientes.errors.decidir')
  }
  if (reserva.estado !== 'reservado') return falloDeReserva(reserva)
  const fila = reserva.fila
  const desde = fila.aplicando_desde

  if (fila.entidad === 'mandato_sepa') {
    try {
      const { mandato_id } = payloadMandatoSepaSchema.parse(fila.payload)
      await decidirMandato(supabase, mandato_id, false)
    } catch (e) {
      logger.warn('rechazarCambio: mandato', e instanceof Error ? e.message : 'desconocido')
      await marcarFallo(supabase, fila.id, desde, 'rechazar_mandato')
      return fail('admin.pendientes.errors.decidir')
    }
    const { error } = await supabase
      .from('cambios_pendientes')
      .update({ aplicando_desde: null })
      .eq('id', fila.id)
      .eq('aplicando_desde', desde)
    // Rechazado y cerrado por la base: la reserva que queda en una fila cerrada no la ve nadie.
    if (error) escrituraSecundariaFallida('rechazarCambio: quitar la reserva', error)
  } else {
    const { data: marcada, error } = await supabase
      .from('cambios_pendientes')
      .update({
        estado: 'rechazado',
        revisado_por: user.id,
        decided_at: new Date().toISOString(),
        aplicando_desde: null,
      })
      .eq('id', fila.id)
      .eq('estado', 'pendiente')
      .eq('aplicando_desde', desde)
      .select('id')
      .maybeSingle()
    if (error || !marcada) {
      // No se rechazó: sigue pendiente (y reservada hasta 2 minutos). Nada que descartar.
      logger.warn('rechazarCambio: marcar rechazado', error?.code ?? '0 filas')
      return fail('admin.pendientes.errors.decidir')
    }
  }

  const service = createServiceRoleClient()
  await descartarCambioPendiente(service, fila).catch(() => undefined)

  revalidatePath('/[locale]/admin/pendientes', 'page')
  return ok({ id: fila.id })
}
