'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { crearEventoCore } from '@/features/eventos/actions/crear-evento'

import { hashTextoAutorizacion } from '../lib/hash'
import { hoyMadridYmd, revalidarAutorizaciones } from '../lib/server-helpers'
import {
  anularAutorizacionSchema,
  crearAutorizacionExcursionSchema,
  crearAutorizacionSalidaSchema,
  crearPlantillaSchema,
  editarTextoAutorizacionSchema,
  enviarAutorizacionSchema,
  publicarAutorizacionSchema,
  type AnularAutorizacionInput,
  type CrearAutorizacionExcursionInput,
  type CrearAutorizacionSalidaInput,
  type CrearPlantillaInput,
  type EditarTextoAutorizacionInput,
  type EnviarAutorizacionInput,
  type PublicarAutorizacionInput,
} from '../schemas/autorizaciones'
import { fail, ok, type ActionResult } from '../types'

// Tipos A (la directora ENVÍA a una audiencia). recogida/medicación = tipos B
// (los inicia la familia) → no son enviables desde aquí.
const TIPOS_ENVIABLES = ['reglas_regimen_interno', 'autorizacion_imagenes'] as const

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
 * Excursión desde el desplegable «Nueva autorización»: si llega `nuevo_evento`,
 * crea el evento `tipo='excursion'` (ámbito centro) ahí mismo —sin saltar al
 * calendario— y cuelga la salida de él; si llega `evento_id`, la cuelga del evento
 * existente. Reusa `crearAutorizacionSalida` para el INSERT de la salida (un único
 * camino para la autorización). El esquema garantiza exactamente una de las dos
 * vías. RLS: admin (cualquier evento de su centro) o profe (evento de su aula).
 */
export async function crearAutorizacionExcursion(
  input: CrearAutorizacionExcursionInput
): Promise<ActionResult<{ autorizacion_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = crearAutorizacionExcursionSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'autorizaciones.errors.creacion_fallo')
  }
  const { titulo, evento_id, nuevo_evento } = parsed.data

  let eventoId = evento_id ?? null
  if (nuevo_evento) {
    // Crea el evento de excursión (ámbito centro) en el mismo flujo. crearEventoCore
    // resuelve centro_id server-side y aplica la RLS de eventos.
    const evRes = await crearEventoCore(supabase, user.id, {
      ambito: 'centro',
      tipo: 'excursion',
      titulo: nuevo_evento.titulo,
      fecha: nuevo_evento.fecha,
      requiere_confirmacion: false,
    })
    if (!evRes.success) return fail(evRes.error)
    eventoId = evRes.data.evento_id
  }
  if (!eventoId) return fail('autorizaciones.errors.creacion_fallo')

  return crearAutorizacionSalida({ evento_id: eventoId, titulo })
}

/**
 * Crea una **plantilla durable** del catálogo (`es_plantilla=true`) para un tipo
 * por-niño (reglas/imágenes/recogida/medicación). Es el FORMATO estándar del
 * centro: no se firma directamente (guard en BD: `autorizacion_firmable=false`
 * para plantillas). Solo **admin** (RLS `autorizaciones_insert` → `es_admin`).
 * Nace borrador con texto `PENDIENTE`; el admin lo teclea, lo marca definitivo y
 * lo publica (queda disponible en el catálogo). Una activa por (centro, tipo):
 * el índice único parcial de BD rechaza la segunda (error claro). `salida` NO usa
 * catálogo (es bespoke por evento → `crearAutorizacionSalida`).
 */
export async function crearPlantilla(
  input: CrearPlantillaInput
): Promise<ActionResult<{ autorizacion_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = crearPlantillaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'autorizaciones.errors.creacion_fallo')
  }
  const { tipo, titulo } = parsed.data

  const centroId = await getCentroActualId()
  if (!centroId) return fail('autorizaciones.errors.no_autorizado')

  const { data: creada, error: insErr } = await supabase
    .from('autorizaciones')
    .insert({
      centro_id: centroId,
      tipo,
      es_plantilla: true,
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
    logger.warn('crearPlantilla: insert', insErr?.message)
    if (insErr?.code === '42501') return fail('autorizaciones.errors.no_autorizado')
    // 23505 = índice único parcial (ya existe una plantilla activa de ese tipo).
    if (insErr?.code === '23505') return fail('autorizaciones.errors.plantilla_duplicada')
    return fail('autorizaciones.errors.creacion_fallo')
  }

  revalidarAutorizaciones()
  return ok({ autorizacion_id: creada.id })
}

/**
 * **Envía** una plantilla publicada (tipo A: reglas/imágenes) a una AUDIENCIA
 * (niño/aula/centro) creando una **instancia firmable** (`es_plantilla=false`,
 * `plantilla_id`, `ambito`). El texto se **congela como snapshot** de la plantilla
 * en el momento del envío (editar la plantilla después = nueva versión; esta
 * instancia conserva su texto/hash). Nace ya **publicada** (la plantilla lo está)
 * para que las familias puedan firmar. Solo **admin** (RLS `es_admin`).
 * recogida/medicación (tipos B) NO se envían: las inicia la familia.
 */
export async function enviarAutorizacion(
  input: EnviarAutorizacionInput
): Promise<ActionResult<{ autorizacion_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = enviarAutorizacionSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'autorizaciones.errors.envio_fallo')
  }
  const { plantilla_id, ambito, nino_id, aula_id } = parsed.data

  // Snapshot de la plantilla (debe ser plantilla A publicada y definitiva).
  const { data: plantilla, error: plErr } = await supabase
    .from('autorizaciones')
    .select(
      'id, tipo, titulo, texto, texto_version, texto_definitivo, estado, centro_id, es_plantilla'
    )
    .eq('id', plantilla_id)
    .maybeSingle()
  if (plErr) {
    logger.warn('enviarAutorizacion: plantilla.select', plErr.message)
    return fail('autorizaciones.errors.envio_fallo')
  }
  if (!plantilla || !plantilla.es_plantilla)
    return fail('autorizaciones.errors.plantilla_no_encontrada')
  if (!TIPOS_ENVIABLES.includes(plantilla.tipo as (typeof TIPOS_ENVIABLES)[number])) {
    return fail('autorizaciones.errors.tipo_no_enviable')
  }
  if (plantilla.estado !== 'publicada' || !plantilla.texto_definitivo) {
    return fail('autorizaciones.errors.plantilla_no_publicada')
  }

  // Política de firmantes: para audiencia de un niño concreto, respeta su flag
  // `requiere_ambos_firmantes`; para aula/centro, 'uno_principal' (el roster
  // aplica el override per-niño al calcular el estado de cada uno).
  let firmantes_requeridos: 'uno_principal' | 'todos_los_principales' = 'uno_principal'
  if (ambito === 'nino' && nino_id) {
    const { data: nino } = await supabase
      .from('ninos')
      .select('requiere_ambos_firmantes')
      .eq('id', nino_id)
      .maybeSingle()
    if (nino?.requiere_ambos_firmantes) firmantes_requeridos = 'todos_los_principales'
  }

  const { data: creada, error: insErr } = await supabase
    .from('autorizaciones')
    .insert({
      centro_id: plantilla.centro_id,
      tipo: plantilla.tipo,
      es_plantilla: false,
      plantilla_id: plantilla.id,
      ambito,
      nino_id: ambito === 'nino' ? (nino_id ?? null) : null,
      aula_id: ambito === 'aula' ? (aula_id ?? null) : null,
      titulo: plantilla.titulo,
      texto: plantilla.texto,
      texto_version: plantilla.texto_version,
      texto_definitivo: true,
      estado: 'publicada',
      firmantes_requeridos,
      vigencia_desde: hoyMadridYmd(),
      creado_por: user.id,
    })
    .select('id')
    .maybeSingle()

  if (insErr || !creada) {
    logger.warn('enviarAutorizacion: insert', insErr?.message)
    if (insErr?.code === '42501') return fail('autorizaciones.errors.no_autorizado')
    return fail('autorizaciones.errors.envio_fallo')
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
