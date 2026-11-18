import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { modoFirmaDocumento } from '@/features/documentos-centro/lib/firmar-documentos'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/db'

import { comprobarAlta, faltanDeHint, type BloqueAlta } from './gate-alta'

/**
 * La ficha firmada en la app (fase 10b-2; spec `altas-serie.md`, «10b-2: el diseño»). Las reglas
 * viven en la base (10b-1, `20270128120000`): qué es la ficha y su sello (`ficha_para_firmar`),
 * quién firma (`firmar_ficha`, el tutor legal que puede leer la ficha médica), si la firma vale
 * (`estado_firma_ficha`) y pedir que se vuelva a firmar (`pedir_refirma_ficha`). Aquí, la sesión.
 *
 * La firma en papel de la ficha no está aquí: llega con la 10b-3, con la función que recibe el tutor
 * que firmó el papel (decisión del 2026-11-18).
 */

type Client = SupabaseClient<Database>

const E = 'alta.firma.errors'

export type PuedeFirmar = 'si' | 'sin_acceso_ficha_medica' | 'presencial' | 'no'

export interface EstadoFirmaFicha {
  firmada: boolean
  /** Hay firma y vale: es la última, no hay refirma posterior y la ficha da su sello. */
  vigente: boolean
  ultimaFirmaEn: string | null
  refirmaPedida: boolean
  puedeFirmar: PuedeFirmar
}

const estadoSchema = z.object({
  firmada: z.boolean(),
  vigente: z.boolean(),
  ultima_firma_en: z.string().nullable(),
  refirma_pedida: z.boolean(),
  puede_firmar: z.enum(['si', 'sin_acceso_ficha_medica', 'presencial', 'no']),
})

export type ResultadoFicha<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; faltan?: BloqueAlta[] }

/**
 * El estado de la firma de la ficha del niño, con la sesión de quien mira (tutor legal o Dirección;
 * a cualquier otro la base le da 42501). Si no se puede leer, no hay estado: nunca se toma por «no
 * firmada».
 */
export async function leerEstadoFirmaFicha(
  sesion: Client,
  ninoId: string
): Promise<ResultadoFicha<EstadoFirmaFicha>> {
  const { data, error } = await sesion.rpc('estado_firma_ficha', { p_nino_id: ninoId })
  if (error) {
    if (error.code !== '42501') logger.warn('ficha firmada: estado', { code: error.code })
    return { ok: false, error: error.code === '42501' ? `${E}.no_autorizado` : `${E}.leer` }
  }
  const parsed = estadoSchema.safeParse(data)
  if (!parsed.success) {
    logger.warn('ficha firmada: estado con otra forma')
    return { ok: false, error: `${E}.leer` }
  }
  const e = parsed.data
  return {
    ok: true,
    data: {
      firmada: e.firmada,
      vigente: e.vigente,
      ultimaFirmaEn: e.ultima_firma_en,
      refirmaPedida: e.refirma_pedida,
      puedeFirmar: e.puede_firmar,
    },
  }
}

const fichaSchema = z.object({
  ficha: z.record(z.string(), z.unknown()),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  ficha_version: z.number().int(),
  plantilla_pdf_version: z.number().int(),
})

export interface FichaParaFirmar {
  ficha: Record<string, unknown>
  /** El sello que se ve: lo que se firma es esto, y la base comprueba que no cambió (`ficha_cambiada`). */
  hash: string
}

/**
 * La ficha entera para firmarla, lo médico descifrado incluido. La base deja su fila en
 * `lecturas_ficha_medica` (origen `alta`): por eso se lee cuando quien firma lo pide, no al pintar.
 */
export async function leerFichaParaFirmar(
  sesion: Client,
  ninoId: string
): Promise<ResultadoFicha<FichaParaFirmar>> {
  const { data, error } = await sesion.rpc('ficha_para_firmar', { p_nino_id: ninoId })
  if (error) {
    // «Nadie firma lo que no puede leer»: se dice en claro, no como error opaco (2026-11-18).
    if (error.hint === 'sin_acceso_ficha_medica') return { ok: false, error: `${E}.sin_acceso` }
    // La ficha médica bloqueada tras la baja (55000).
    if (error.code === '55000') return { ok: false, error: `${E}.bloqueada` }
    if (error.code === '42501') return { ok: false, error: `${E}.no_autorizado` }
    logger.warn('ficha firmada: leer', { code: error.code })
    return { ok: false, error: `${E}.leer` }
  }
  const parsed = fichaSchema.safeParse(data)
  if (!parsed.success) {
    logger.warn('ficha firmada: ficha con otra forma')
    return { ok: false, error: `${E}.leer` }
  }
  return { ok: true, data: { ficha: parsed.data.ficha, hash: parsed.data.hash } }
}

/** Tope del trazo, el mismo que el del mandato, las autorizaciones y los documentos. */
const MAX_FIRMA_CHARS = 500000

export const firmarFichaSchema = z.object({
  ninoId: z.string().uuid(),
  hashVisto: z.string().regex(/^[0-9a-f]{64}$/),
  nombreTecleado: z.string().trim().min(1).max(200),
  firmaImagen: z.string().max(MAX_FIRMA_CHARS),
})

export interface ContextoPeticion {
  ip: string | null
  userAgent: string | null
}

/** El error de la base al firmar, como clave de la app (o lo que falta para cerrar el alta). */
function errorDeFirma(error: { code?: string; hint?: string | null }): {
  error: string
  faltan?: BloqueAlta[]
} {
  const faltan = faltanDeHint(error.hint)
  if (faltan) return { error: 'alta.errors.incompleto', faltan }
  switch (error.hint) {
    case 'ficha_cambiada':
      return { error: `${E}.ficha_cambiada` }
    case 'nada_que_firmar':
      return { error: `${E}.ya_firmada` }
    case 'sin_acceso_ficha_medica':
      return { error: `${E}.sin_acceso` }
    case 'alta_no_cerrada':
      return { error: 'alta.errors.finalizar_fallo' }
  }
  if (error.code === '42501') return { error: `${E}.no_autorizado` }
  logger.warn('ficha firmada: firmar', { code: error.code, hint: error.hint })
  return { error: `${E}.firmar` }
}

/**
 * Firma la ficha con el dedo: el tutor legal. Con el alta pendiente, firmar es finalizar: antes corre
 * el gate de completitud (`comprobarAlta`) y, si falta algo, se dice qué, como «Finalizar». Con el
 * alta en `lista` (la firma dejó de valer) o con la refirma pedida, solo firma de nuevo.
 *
 * El modo lo decide el servidor (`modoFirmaDocumento`): sin vínculo con el niño no se firma aquí.
 */
export async function firmarFichaNino(
  sesion: Client,
  usuarioId: string,
  input: unknown,
  contexto: ContextoPeticion
): Promise<ResultadoFicha<{ firmaId: string }>> {
  const parsed = firmarFichaSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: `${E}.invalido` }
  const { ninoId, hashVisto, nombreTecleado, firmaImagen } = parsed.data
  if (!firmaImagen.startsWith('data:image/')) return { ok: false, error: `${E}.sin_trazo` }

  const modo = await modoFirmaDocumento(sesion, ninoId, usuarioId)
  if (modo !== 'digital') return { ok: false, error: `${E}.no_autorizado` }

  const { data: matricula, error: mError } = await sesion
    .from('matriculas')
    .select('estado')
    .eq('nino_id', ninoId)
    .eq('estado', 'pendiente')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (mError) {
    logger.warn('ficha firmada: matrícula', { code: mError.code })
    return { ok: false, error: `${E}.firmar` }
  }
  if (matricula) {
    const gate = await comprobarAlta(sesion, ninoId, usuarioId, false)
    if (!gate.ok) return { ok: false, error: 'alta.errors.finalizar_fallo' }
    if (gate.faltan.length > 0)
      return { ok: false, error: 'alta.errors.incompleto', faltan: gate.faltan }
  }

  const { data, error } = await sesion.rpc('firmar_ficha', {
    p_nino_id: ninoId,
    p_hash_visto: hashVisto,
    p_nombre_tecleado: nombreTecleado,
    p_firma_imagen: firmaImagen,
    p_ip_address: contexto.ip ?? undefined,
    p_user_agent: contexto.userAgent ?? undefined,
  })
  if (error || !data) {
    const e = error ? errorDeFirma(error) : { error: `${E}.firmar` }
    return { ok: false, ...e }
  }
  return { ok: true, data: { firmaId: data } }
}

/** Dirección pide que se vuelva a firmar (`pedir_refirma_ficha`; sin firma, `sin_firma`). */
export async function pedirRefirmaFicha(
  sesion: Client,
  ninoId: string
): Promise<ResultadoFicha<{ id: string }>> {
  const { data, error } = await sesion.rpc('pedir_refirma_ficha', { p_nino_id: ninoId })
  if (error || !data) {
    if (error?.hint === 'sin_firma') return { ok: false, error: `${E}.sin_firma` }
    if (error?.code === '42501') return { ok: false, error: `${E}.no_autorizado` }
    logger.warn('ficha firmada: pedir refirma', { code: error?.code })
    return { ok: false, error: `${E}.refirma` }
  }
  return { ok: true, data: { id: data } }
}

/** La última firma del niño (quién, cuándo, cómo), con las columnas que la sesión lee. */
export interface UltimaFirmaFicha {
  firmadoAt: string
  metodo: 'digital' | 'presencial'
  rolFirmante: string
  firmanteId: string
}

export async function leerUltimaFirmaFicha(
  sesion: Client,
  ninoId: string
): Promise<ResultadoFicha<UltimaFirmaFicha | null>> {
  const { data, error } = await sesion
    .from('firmas_ficha')
    .select('firmado_at, metodo_firma, rol_firmante, firmante_id')
    .eq('nino_id', ninoId)
    .order('firmado_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    logger.warn('ficha firmada: última firma', { code: error.code })
    return { ok: false, error: `${E}.leer` }
  }
  if (!data) return { ok: true, data: null }
  return {
    ok: true,
    data: {
      firmadoAt: data.firmado_at,
      metodo: data.metodo_firma as UltimaFirmaFicha['metodo'],
      rolFirmante: String(data.rol_firmante),
      firmanteId: data.firmante_id,
    },
  }
}
