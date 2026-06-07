'use server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { hashFirma } from '../lib/hash'
import { getRequestContext } from '../lib/request-context'
import { hoyMadridYmd, revalidarAutorizaciones } from '../lib/server-helpers'
import {
  firmarAutorizacionSchema,
  rechazarAutorizacionSchema,
  revocarFirmaSchema,
  type FirmarAutorizacionInput,
  type RechazarAutorizacionInput,
  type RevocarFirmaInput,
} from '../schemas/autorizaciones'
import { fail, ok, type ActionResult, type FirmaDecision, type PersonaAutorizada } from '../types'

/** Compara nombres de forma laxa: minúsculas, sin acentos, espacios colapsados. */
function normalizarNombre(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

interface DatosDecision {
  autorizacion_id: string
  nino_id: string
  decision: FirmaDecision
  /** Nombre tecleado (firmado) o autorrellenado del perfil (rechazo/revocación). */
  nombre_tecleado: string
  /** Trazo del canvas; obligatorio solo en `firmado` (CHECK de BD). */
  firma_imagen: string | null
  comentario: string | null
  /** Recogida: lista de personas autorizadas que se firma (atada al hash). */
  personas?: PersonaAutorizada[]
}

/**
 * Núcleo común de las tres decisiones (firmar/rechazar/revocar). Lee el documento
 * vigente, **computa el hash SHA-256 del texto server-side**, snapshot de la
 * versión, resuelve el `rol_firmante` desde el vínculo, captura IP/UA e inserta
 * una fila **append-only** en `firmas_autorizacion`. La RLS `firmas_insert`
 * enforza que sea un tutor del niño, sobre una autorización firmable (publicada +
 * texto_definitivo + dentro de vigencia) — un texto `PENDIENTE` nunca llega aquí.
 */
async function registrarDecision(
  supabase: SupabaseClient<Database>,
  userId: string,
  d: DatosDecision
): Promise<ActionResult<{ firma_id: string }>> {
  // 1. Documento vigente (el tutor lo ve por RLS de audiencia).
  const { data: aut, error: autErr } = await supabase
    .from('autorizaciones')
    .select(
      'id, tipo, texto, texto_version, estado, texto_definitivo, vigencia_desde, vigencia_hasta'
    )
    .eq('id', d.autorizacion_id)
    .maybeSingle()
  if (autErr || !aut) return fail('autorizaciones.errors.no_encontrada')

  // Recogida: al firmar es obligatoria la lista de personas autorizadas.
  if (
    aut.tipo === 'recogida' &&
    d.decision === 'firmado' &&
    (!d.personas || d.personas.length === 0)
  ) {
    return fail('autorizaciones.errors.personas_requeridas')
  }

  // 2. Firmable (pre-chequeo para error claro; la RLS lo vuelve a enforzar).
  const hoy = hoyMadridYmd()
  const dentroVigencia =
    (!aut.vigencia_desde || hoy >= aut.vigencia_desde) &&
    (!aut.vigencia_hasta || hoy <= aut.vigencia_hasta)
  if (aut.estado !== 'publicada' || !aut.texto_definitivo || !dentroVigencia) {
    return fail('autorizaciones.errors.no_firmable')
  }

  // 3. rol_firmante = snapshot del vínculo del tutor con el niño.
  const { data: vinculo } = await supabase
    .from('vinculos_familiares')
    .select('tipo_vinculo')
    .eq('nino_id', d.nino_id)
    .eq('usuario_id', userId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!vinculo) return fail('autorizaciones.errors.no_es_tutor')

  // 4. Hash **compuesto** texto + lista (recogida) + contexto probatorio. Sin
  //    lista, hashFirma == sha256(texto) (compat F8-1/F8-2b).
  const tienePersonas = !!d.personas && d.personas.length > 0
  const datos = (
    tienePersonas ? { personas: d.personas } : {}
  ) as Database['public']['Tables']['firmas_autorizacion']['Insert']['datos']
  const texto_hash = hashFirma(aut.texto, tienePersonas ? { personas: d.personas } : undefined)
  const { ip, userAgent } = await getRequestContext()

  // 5. Inserción append-only.
  const { data: firma, error: insErr } = await supabase
    .from('firmas_autorizacion')
    .insert({
      autorizacion_id: aut.id,
      nino_id: d.nino_id,
      firmante_id: userId,
      rol_firmante: vinculo.tipo_vinculo,
      decision: d.decision,
      texto_hash,
      texto_version: aut.texto_version,
      nombre_tecleado: d.nombre_tecleado,
      firma_imagen: d.firma_imagen,
      comentario: d.comentario,
      datos,
      ip_address: ip,
      user_agent: userAgent,
    })
    .select('id')
    .maybeSingle()

  if (insErr || !firma) {
    logger.warn('registrarDecision: insert', insErr?.message)
    if (insErr?.code === '42501') return fail('autorizaciones.errors.no_firmable')
    return fail('autorizaciones.errors.firma_fallo')
  }

  revalidarAutorizaciones()
  return ok({ firma_id: firma.id })
}

/**
 * Firma (acto afirmativo) de un tutor por su niño. Exige `nombre_tecleado` que
 * coincida con el del perfil y `firma_imagen` (trazo del canvas, obligatorio al
 * firmar por CHECK de BD).
 */
export async function firmarAutorizacion(
  input: FirmarAutorizacionInput
): Promise<ActionResult<{ firma_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = firmarAutorizacionSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'autorizaciones.errors.firma_fallo')
  }
  const d = parsed.data

  // El nombre tecleado debe coincidir con el del perfil (acto afirmativo explícito).
  const { data: perfil } = await supabase
    .from('usuarios')
    .select('nombre_completo')
    .eq('id', user.id)
    .maybeSingle()
  if (!perfil || normalizarNombre(perfil.nombre_completo) !== normalizarNombre(d.nombre_tecleado)) {
    return fail('autorizaciones.errors.nombre_no_coincide')
  }

  return registrarDecision(supabase, user.id, {
    autorizacion_id: d.autorizacion_id,
    nino_id: d.nino_id,
    decision: 'firmado',
    nombre_tecleado: d.nombre_tecleado.trim(),
    firma_imagen: d.firma_imagen,
    comentario: d.comentario ?? null,
    personas: d.personas?.map((p) => ({
      nombre: p.nombre.trim(),
      dni: p.dni.trim(),
      ...(p.parentesco?.trim() ? { parentesco: p.parentesco.trim() } : {}),
    })),
  })
}

/**
 * Rechazo de un tutor: no autoriza. Sin trazo (no hay firma que dibujar); el
 * `nombre_tecleado` se autorrellena del perfil para cumplir el NOT NULL.
 */
export async function rechazarAutorizacion(
  input: RechazarAutorizacionInput
): Promise<ActionResult<{ firma_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = rechazarAutorizacionSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'autorizaciones.errors.firma_fallo')
  }
  const d = parsed.data

  const { data: perfil } = await supabase
    .from('usuarios')
    .select('nombre_completo')
    .eq('id', user.id)
    .maybeSingle()
  if (!perfil) return fail('autorizaciones.errors.no_autorizado')

  return registrarDecision(supabase, user.id, {
    autorizacion_id: d.autorizacion_id,
    nino_id: d.nino_id,
    decision: 'rechazado',
    nombre_tecleado: perfil.nombre_completo,
    firma_imagen: null,
    comentario: d.comentario ?? null,
  })
}

/**
 * Revoca una firma previa añadiendo una fila nueva `decision='revocado'`
 * (append-only, conserva la traza — D4). Solo válido mientras la autorización
 * siga firmable (publicada + vigente).
 */
export async function revocarFirma(
  input: RevocarFirmaInput
): Promise<ActionResult<{ firma_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = revocarFirmaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'autorizaciones.errors.firma_fallo')
  }
  const d = parsed.data

  const { data: perfil } = await supabase
    .from('usuarios')
    .select('nombre_completo')
    .eq('id', user.id)
    .maybeSingle()
  if (!perfil) return fail('autorizaciones.errors.no_autorizado')

  return registrarDecision(supabase, user.id, {
    autorizacion_id: d.autorizacion_id,
    nino_id: d.nino_id,
    decision: 'revocado',
    nombre_tecleado: perfil.nombre_completo,
    firma_imagen: null,
    comentario: d.comentario ?? null,
  })
}
