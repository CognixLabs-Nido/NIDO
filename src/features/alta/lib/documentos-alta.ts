import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { esSuperusuario } from '@/features/centros/contexto/roles-del-usuario'
import { BUCKET_DOCUMENTOS_CENTRO } from '@/shared/lib/adjuntos/storage'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { esAdminDeCentroDeNino } from './authz-tutor'

/**
 * Los documentos del centro en el alta (fase 4, 4b-1; spec `altas-serie.md`, «Fase 4»). La familia
 * los firma con el dedo y la Dirección, en el modo Dirección del alta, registra la firma en papel.
 * Las reglas viven en la base (4a, `20270103120000`): qué le toca a cada niño
 * (`documentos_firma_nino`), quién firma con el dedo (`firmar_documento_centro`, el tutor legal),
 * quién en persona (`registrar_firma_documento_presencial`, Dirección sin el superusuario) y de qué
 * PDF es el enlace (`ruta_version_documento_nino`). Aquí, la sesión y el modo.
 */

type Client = SupabaseClient<Database>

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

export type DocumentoAlta =
  Database['public']['Functions']['documentos_firma_nino']['Returns'][number]

export type MetodoFirmaAlta = 'digital' | 'presencial'

const E = 'alta.documentos_centro.errors'

/** Lo que dura el enlace para abrir el PDF desde el alta, como en la pantalla de la admin. */
export const SEGUNDOS_ENLACE_DOCUMENTO_ALTA = 60

/** Tope del trazo, el mismo que el del mandato y el de las autorizaciones. */
const MAX_FIRMA_CHARS = 500000

/**
 * Lo que le toca firmar al niño, con la sesión de quien abre el alta. Si la lectura falla, no hay
 * lista: una lista vacía diría «no hay nada que firmar».
 */
export async function leerDocumentosAlta(
  sesion: Client,
  ninoId: string
): Promise<Resultado<DocumentoAlta[]>> {
  const { data, error } = await sesion.rpc('documentos_firma_nino', { p_nino_id: ninoId })
  if (error) {
    logger.warn('alta: documentos del centro', { code: error.code })
    return { ok: false, error: `${E}.leer` }
  }
  return { ok: true, data: data ?? [] }
}

/**
 * Cómo firma quien llama, decidido en el servidor con la misma regla que la entrada del alta
 * (`resolverEntradaAlta`): con vínculo vivo con el niño, como familia, con el dedo; sin vínculo y
 * Dirección del centro del niño, en persona. Nunca lo dice el navegador.
 *
 * El mandato SEPA decide «en persona» solo con `esAdminDeCentroDeNino`, sin mirar el vínculo; aquí
 * se mira primero el vínculo para que la pantalla (que entra en modo Dirección solo sin vínculo) y
 * el servidor digan lo mismo.
 */
export async function modoFirmaAlta(
  sesion: Client,
  ninoId: string,
  usuarioId: string
): Promise<MetodoFirmaAlta | null> {
  const { data: vinculo, error } = await sesion
    .from('vinculos_familiares')
    .select('id')
    .eq('nino_id', ninoId)
    .eq('usuario_id', usuarioId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    logger.warn('alta: vínculo para firmar', { code: error.code })
    return null
  }
  if (vinculo) return 'digital'
  return (await esAdminDeCentroDeNino(sesion, ninoId, usuarioId)) ? 'presencial' : null
}

export const firmarDocumentoAltaSchema = z.object({
  ninoId: z.string().uuid(),
  versionId: z.string().uuid(),
  nombreTecleado: z.string().trim().min(1).max(200),
  /** El trazo. Solo cuenta con el dedo; en persona no hay trazo y se ignora. */
  firmaImagen: z.string().max(MAX_FIRMA_CHARS).nullable(),
})

export type FirmarDocumentoAltaInput = z.infer<typeof firmarDocumentoAltaSchema>

export interface ContextoPeticion {
  ip: string | null
  userAgent: string | null
}

/**
 * El navegador, o NULL. Las dos funciones no tienen DEFAULT: un argumento que falta no es NULL, es
 * otra firma y PostgREST no la encuentra (PGRST202), así que va siempre, y NULL si no se sabe. El
 * tipo generado dice `string` porque no ve que la columna admite NULL.
 */
function userAgent(contexto: ContextoPeticion): string {
  return contexto.userAgent as string
}

/** El error de la base, como clave de la app. */
function errorDeLaBase(error: { code?: string; hint?: string | null }): string {
  if (error.hint === 'ya_firmado') return `${E}.ya_firmado`
  if (error.hint === 'version_no_vigente') return `${E}.version_no_vigente`
  if (error.code === '42501') return `${E}.no_autorizado`
  logger.warn('alta: firmar documento del centro', { code: error.code, hint: error.hint })
  return `${E}.firmar`
}

/**
 * Firma un documento del centro desde el alta. El modo lo decide `modoFirmaAlta`; el superusuario
 * no registra en persona (ADR-0061; la base también se lo cierra). Con el dedo hace falta el trazo.
 */
export async function firmarDocumentoAlta(
  sesion: Client,
  usuarioId: string,
  input: unknown,
  contexto: ContextoPeticion
): Promise<Resultado<{ firmaId: string; metodo: MetodoFirmaAlta }>> {
  const parsed = firmarDocumentoAltaSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: `${E}.invalido` }
  const { ninoId, versionId, nombreTecleado, firmaImagen } = parsed.data

  const metodo = await modoFirmaAlta(sesion, ninoId, usuarioId)
  if (!metodo) return { ok: false, error: `${E}.no_autorizado` }

  if (metodo === 'presencial') {
    if (await esSuperusuario(sesion))
      return { ok: false, error: 'alta.errors.presencial_solo_direccion' }
    const { data, error } = await sesion.rpc('registrar_firma_documento_presencial', {
      p_version_id: versionId,
      p_nino_id: ninoId,
      p_nombre_tecleado: nombreTecleado,
      p_ip_address: contexto.ip,
      p_user_agent: userAgent(contexto),
    })
    if (error || !data) return { ok: false, error: error ? errorDeLaBase(error) : `${E}.firmar` }
    return { ok: true, data: { firmaId: data, metodo } }
  }

  if (!firmaImagen || !firmaImagen.startsWith('data:image/')) {
    return { ok: false, error: `${E}.sin_trazo` }
  }
  const { data, error } = await sesion.rpc('firmar_documento_centro', {
    p_version_id: versionId,
    p_nino_id: ninoId,
    p_nombre_tecleado: nombreTecleado,
    p_firma_imagen: firmaImagen,
    p_ip_address: contexto.ip,
    p_user_agent: userAgent(contexto),
  })
  if (error || !data) return { ok: false, error: error ? errorDeLaBase(error) : `${E}.firmar` }
  return { ok: true, data: { firmaId: data, metodo } }
}

/**
 * El enlace firmado al PDF de una versión, para abrirlo desde el alta. Qué ruta es lo dice la base
 * (`ruta_version_documento_nino`, con la sesión: solo una versión que al niño le toca firmar o que
 * ya firmó, a quien puede leer sus documentos); el enlace lo firma el servicio, porque el bucket no
 * tiene políticas para nadie.
 */
export async function enlaceDocumentoAlta(
  sesion: Client,
  service: Client,
  ninoId: string,
  versionId: string
): Promise<Resultado<{ url: string }>> {
  const { data: ruta, error } = await sesion.rpc('ruta_version_documento_nino', {
    p_version_id: versionId,
    p_nino_id: ninoId,
  })
  if (error || !ruta) {
    if (error && error.code !== '42501')
      logger.warn('alta: ruta del documento', { code: error.code })
    return { ok: false, error: `${E}.no_autorizado` }
  }
  const { data: firmada, error: e } = await service.storage
    .from(BUCKET_DOCUMENTOS_CENTRO)
    .createSignedUrl(ruta, SEGUNDOS_ENLACE_DOCUMENTO_ALTA)
  if (e || !firmada?.signedUrl) {
    logger.warn('alta: enlace del documento', e?.message ?? 'sin enlace')
    return { ok: false, error: `${E}.abrir` }
  }
  return { ok: true, data: { url: firmada.signedUrl } }
}
