'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { hashTextoAutorizacion } from '../lib/hash'
import { hoyMadridYmd, revalidarAutorizaciones } from '../lib/server-helpers'
import {
  anularAutorizacionSchema,
  crearAutorizacionPorNinoSchema,
  crearAutorizacionSalidaSchema,
  editarTextoAutorizacionSchema,
  publicarAutorizacionSchema,
  type AnularAutorizacionInput,
  type CrearAutorizacionPorNinoInput,
  type CrearAutorizacionSalidaInput,
  type EditarTextoAutorizacionInput,
  type PublicarAutorizacionInput,
} from '../schemas/autorizaciones'
import { fail, ok, type ActionResult } from '../types'

/**
 * Crea una autorización de **salida** colgando de un evento (`tipo='excursion'`).
 * admin (cualquier evento de su centro) o profe (evento ámbito aula de su aula) —
 * lo enforza la RLS `autorizaciones_insert` (espejo de `eventos_insert`). Nace
 * como **borrador** con texto placeholder `PENDIENTE` (no publicable ni firmable
 * hasta que el responsable teclee el texto real y lo marque definitivo). El
 * `centro_id` se deriva del evento server-side.
 */
export async function crearAutorizacionSalida(
  input: CrearAutorizacionSalidaInput
): Promise<ActionResult<{ autorizacion_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = crearAutorizacionSalidaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'autorizaciones.errors.creacion_fallo')
  }
  const { evento_id, titulo } = parsed.data

  // centro_id desde el evento (red de seguridad; el trigger BD lo deriva igual).
  const { data: evento, error: evErr } = await supabase
    .from('eventos')
    .select('id, centro_id, tipo')
    .eq('id', evento_id)
    .maybeSingle()
  if (evErr) {
    logger.warn('crearAutorizacionSalida: eventos.select', evErr.message)
    return fail('autorizaciones.errors.creacion_fallo')
  }
  if (!evento) return fail('autorizaciones.errors.evento_no_encontrado')

  const { data: creada, error: insErr } = await supabase
    .from('autorizaciones')
    .insert({
      centro_id: evento.centro_id,
      tipo: 'salida',
      evento_id: evento.id,
      titulo,
      texto: 'PENDIENTE',
      texto_version: 'v0-pendiente',
      texto_definitivo: false,
      estado: 'borrador',
      firmantes_requeridos: 'uno_principal',
      creado_por: user.id,
    })
    .select('id')
    .maybeSingle()

  if (insErr || !creada) {
    logger.warn('crearAutorizacionSalida: insert', insErr?.message)
    if (insErr?.code === '42501') return fail('autorizaciones.errors.no_autorizado')
    return fail('autorizaciones.errors.creacion_fallo')
  }

  revalidarAutorizaciones()
  return ok({ autorizacion_id: creada.id })
}

/**
 * Crea una autorización que cuelga del **niño** (reglas de régimen interno y, en
 * sub-fases siguientes, recogida/medicación/imágenes). Solo **admin** del centro
 * (la RLS `autorizaciones_insert` reserva los tipos no-`salida` al admin). La
 * política de firmantes se deriva del flag `requiere_ambos_firmantes` del niño
 * (minimización: el requisito vive en el niño). Nace borrador con texto
 * `PENDIENTE`. Reutiliza el resto del flujo de F8-1 sin cambios (editar/publicar/
 * firmar/roster). Mismo patrón → recogida/medicación lo reusarán tal cual.
 */
export async function crearAutorizacionPorNino(
  input: CrearAutorizacionPorNinoInput
): Promise<ActionResult<{ autorizacion_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = crearAutorizacionPorNinoSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'autorizaciones.errors.creacion_fallo')
  }
  const { tipo, nino_id, titulo } = parsed.data

  // centro_id + política desde el niño (red de seguridad; el trigger BD deriva centro_id).
  const { data: nino, error: ninoErr } = await supabase
    .from('ninos')
    .select('centro_id, requiere_ambos_firmantes')
    .eq('id', nino_id)
    .maybeSingle()
  if (ninoErr) {
    logger.warn('crearAutorizacionPorNino: ninos.select', ninoErr.message)
    return fail('autorizaciones.errors.creacion_fallo')
  }
  if (!nino) return fail('autorizaciones.errors.nino_no_encontrado')

  const { data: creada, error: insErr } = await supabase
    .from('autorizaciones')
    .insert({
      centro_id: nino.centro_id,
      tipo,
      nino_id,
      titulo,
      texto: 'PENDIENTE',
      texto_version: 'v0-pendiente',
      texto_definitivo: false,
      estado: 'borrador',
      firmantes_requeridos: nino.requiere_ambos_firmantes
        ? 'todos_los_principales'
        : 'uno_principal',
      creado_por: user.id,
    })
    .select('id')
    .maybeSingle()

  if (insErr || !creada) {
    logger.warn('crearAutorizacionPorNino: insert', insErr?.message)
    if (insErr?.code === '42501') return fail('autorizaciones.errors.no_autorizado')
    return fail('autorizaciones.errors.creacion_fallo')
  }

  revalidarAutorizaciones()
  return ok({ autorizacion_id: creada.id })
}

/**
 * Teclea/edita el **texto** de la autorización y lo marca (o no) `texto_definitivo`.
 * El texto legal real lo pega el responsable; en pruebas vale un texto cualquiera.
 * `texto_version` se ata al contenido (prefijo del hash) para que cada texto
 * definitivo tenga una versión inequívoca. El trigger BD bloquea editar el texto
 * si ya existen firmas (integridad del hash). RLS: autor o admin.
 */
export async function editarTextoAutorizacion(
  input: EditarTextoAutorizacionInput
): Promise<ActionResult<{ autorizacion_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = editarTextoAutorizacionSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'autorizaciones.errors.edicion_fallo')
  }
  const d = parsed.data

  const texto_version = d.texto_definitivo
    ? `def-${hashTextoAutorizacion(d.texto).slice(0, 12)}`
    : 'v0-pendiente'

  const { data: upd, error } = await supabase
    .from('autorizaciones')
    .update({
      titulo: d.titulo,
      texto: d.texto,
      texto_version,
      texto_definitivo: d.texto_definitivo,
      vigencia_hasta: d.vigencia_hasta ?? null,
    })
    .eq('id', d.autorizacion_id)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('editarTextoAutorizacion: update', error.message)
    // El trigger lanza integrity_constraint_violation (23505/23514 family) si hay firmas.
    if (error.code === '42501') return fail('autorizaciones.errors.no_autorizado')
    return fail('autorizaciones.errors.texto_bloqueado_firmas')
  }
  if (!upd) return fail('autorizaciones.errors.no_autorizado')

  revalidarAutorizaciones()
  return ok({ autorizacion_id: upd.id })
}

/**
 * Publica una autorización (borrador → publicada) para que los tutores puedan
 * firmarla. Exige `texto_definitivo` (el CHECK de BD lo refuerza). Fija
 * `vigencia_desde` a hoy (Madrid) si no estaba puesta. RLS: autor o admin.
 */
export async function publicarAutorizacion(
  input: PublicarAutorizacionInput
): Promise<ActionResult<{ autorizacion_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = publicarAutorizacionSchema.safeParse(input)
  if (!parsed.success) return fail('autorizaciones.errors.publicacion_fallo')

  // Pre-chequeo del guard del placeholder para un error claro (el CHECK también lo cubre).
  const { data: aut, error: selErr } = await supabase
    .from('autorizaciones')
    .select('id, texto_definitivo, estado, vigencia_desde')
    .eq('id', parsed.data.autorizacion_id)
    .maybeSingle()
  if (selErr || !aut) return fail('autorizaciones.errors.no_encontrada')
  if (!aut.texto_definitivo) return fail('autorizaciones.errors.texto_no_definitivo')

  const { data: upd, error } = await supabase
    .from('autorizaciones')
    .update({
      estado: 'publicada',
      vigencia_desde: aut.vigencia_desde ?? hoyMadridYmd(),
    })
    .eq('id', aut.id)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('publicarAutorizacion: update', error.message)
    if (error.code === '42501') return fail('autorizaciones.errors.no_autorizado')
    return fail('autorizaciones.errors.publicacion_fallo')
  }
  if (!upd) return fail('autorizaciones.errors.no_autorizado')

  revalidarAutorizaciones()
  return ok({ autorizacion_id: upd.id })
}

/**
 * Anula una autorización (estado → `anulada`). No se borra (DELETE DENY); las
 * firmas previas se conservan (traza). RLS: autor o admin.
 */
export async function anularAutorizacion(
  input: AnularAutorizacionInput
): Promise<ActionResult<{ autorizacion_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = anularAutorizacionSchema.safeParse(input)
  if (!parsed.success) return fail('autorizaciones.errors.anulacion_fallo')

  const { data: upd, error } = await supabase
    .from('autorizaciones')
    .update({ estado: 'anulada' })
    .eq('id', parsed.data.autorizacion_id)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('anularAutorizacion: update', error.message)
    if (error.code === '42501') return fail('autorizaciones.errors.no_autorizado')
    return fail('autorizaciones.errors.anulacion_fallo')
  }
  if (!upd) return fail('autorizaciones.errors.no_autorizado')

  revalidarAutorizaciones()
  return ok({ autorizacion_id: upd.id })
}
