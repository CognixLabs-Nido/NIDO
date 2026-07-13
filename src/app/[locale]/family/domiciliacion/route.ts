import { createHash } from 'node:crypto'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { familiaDelUsuarioActual } from '@/features/alta/queries/get-familia-usuario'
import { familiaTieneMandatoActivo } from '@/features/alta/queries/get-mandato-familia'
import { ibanValido, normalizarIban } from '@/features/alta/lib/iban'
import { MAX_LARGO_IDENTIFICADOR, textoCanonicoMandato } from '@/features/alta/lib/mandato-sepa'
import { BUCKET_MANDATO_SEPA, firmarRuta } from '@/shared/lib/adjuntos/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_PDF_BYTES = 10 * 1024 * 1024
const MAX_FIRMA_CHARS = 500000

interface RespuestaOk {
  success: true
  mandato: { identificador: string; documento: { path: string; url: string | null } }
}
interface RespuestaError {
  success: false
  error: string
}

function err(error: string, status = 400): Response {
  return Response.json({ success: false, error } satisfies RespuestaError, { status })
}

/**
 * F-2c-4 — gestión de la domiciliación SEPA por el TUTOR desde `/family/recibos`, con firma
 * DIGITAL completa (mismo rigor que el paso 8 del alta): el cliente dibuja el trazo, genera el
 * PDF (jsPDF) y lo envía aquí con el IBAN, el titular, el identificador único y el trazo. Todo
 * con el **cliente del USUARIO**:
 *  - la FAMILIA + el CENTRO se resuelven SERVER-SIDE desde `auth.uid()` (nunca del cliente),
 *  - el PDF se sube al bucket `mandato-sepa` en una ruta FAMILIA-scoped
 *    `{centroId}/familia/{familiaId}/mandato-{timestamp}.pdf` (RLS de storage F-2c-4 autoriza al
 *    tutor de la familia; el timestamp conserva el histórico de PDFs, no pisa el del alta),
 *  - la fila se persiste vía RPC (SECURITY DEFINER) que autoriza `es_tutor_de_familia` y CIFRA
 *    el IBAN. Se decide `registrar` (1er mandato) vs `sustituir` (revoca+inserta) según la
 *    familia tenga ya un mandato activo — espejo de la action presencial de Dirección (F-2c-3).
 * El `texto_hash` se calcula aquí sobre el IBAN **en claro del formulario** (ancla el contenido
 * firmado, independiente del cifrado en reposo). El IBAN nunca se almacena en claro.
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('alta.errors.no_autorizado', 401)

  // Familia + centro del tutor, SERVER-SIDE (1:1 por índice único). Nunca del cliente.
  const familia = await familiaDelUsuarioActual()
  if (!familia) return err('alta.errors.no_autorizado', 403)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return err('alta.documentos.errors.subida')
  }

  const file = form.get('file')
  const ibanRaw = form.get('iban')
  const titular = form.get('titular')
  const identificador = form.get('identificador_mandato')
  const nombreTecleado = form.get('nombre_tecleado')
  const firmaImagen = form.get('firma_imagen')

  if (!(file instanceof Blob)) return err('alta.documentos.errors.subida')
  if (file.type !== 'application/pdf') return err('alta.documentos.errors.tipo_pdf')
  if (file.size > MAX_PDF_BYTES) return err('alta.documentos.errors.tamano')

  if (typeof ibanRaw !== 'string' || !ibanValido(ibanRaw)) return err('alta.sepa.errors.iban')
  if (typeof titular !== 'string' || titular.trim().length < 2 || titular.length > 140)
    return err('alta.sepa.errors.titular')
  if (
    typeof identificador !== 'string' ||
    identificador.length < 1 ||
    identificador.length > MAX_LARGO_IDENTIFICADOR
  )
    return err('alta.sepa.errors.guardado')
  if (
    typeof nombreTecleado !== 'string' ||
    nombreTecleado.trim().length < 2 ||
    nombreTecleado.length > 140
  )
    return err('alta.sepa.errors.nombre')
  // Digital SIEMPRE: el trazo es obligatorio (no hay modo presencial en el camino del tutor).
  if (
    typeof firmaImagen !== 'string' ||
    !firmaImagen.startsWith('data:image/') ||
    firmaImagen.length > MAX_FIRMA_CHARS
  )
    return err('alta.sepa.errors.firma')

  const iban = normalizarIban(ibanRaw)
  // Ruta FAMILIA-scoped con timestamp (conserva histórico; no pisa el PDF nino-scoped del alta).
  const path = `${familia.centroId}/familia/${familia.familiaId}/mandato-${Date.now()}.pdf`

  // Acreedor = centro (nombre) para el canónico que se hashea. RLS `centros`: pertenece_a_centro
  // → el tutor lo lee con su cliente.
  const { data: centro } = await supabase
    .from('centros')
    .select('nombre')
    .eq('id', familia.centroId)
    .maybeSingle()

  const fechaFirmaIso = new Date().toISOString()
  const textoHash = createHash('sha256')
    .update(
      textoCanonicoMandato({
        identificadorMandato: identificador,
        iban,
        titular: titular.trim(),
        acreedorNombre: centro?.nombre ?? '',
        fechaFirmaIso,
      })
    )
    .digest('hex')

  // 1. Subida del PDF (cliente de usuario; RLS de storage F-2c-4 autoriza al tutor de la familia).
  const subida = await supabase.storage
    .from(BUCKET_MANDATO_SEPA)
    .upload(path, file, { contentType: 'application/pdf', upsert: true })
  if (subida.error) {
    const msg = subida.error.message
    if (/row-level security|unauthorized|403/i.test(msg))
      return err('alta.errors.no_autorizado', 403)
    logger.warn('domiciliacion-tutor: upload', msg)
    return err('alta.documentos.errors.subida', 500)
  }

  // 2. Decide registrar (sin activo) vs sustituir (con activo) — espejo de la action presencial.
  const activo = await familiaTieneMandatoActivo(familia.familiaId)
  const rpc = activo ? 'sustituir_mandato_sepa' : 'registrar_mandato_sepa'

  const ipAddress = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null
  const userAgent = request.headers.get('user-agent')?.slice(0, 500) ?? null

  const { error: rpcErr } = await supabase.rpc(rpc, {
    p_familia_id: familia.familiaId,
    p_nino_id: null,
    p_iban: iban,
    p_titular: titular.trim(),
    p_identificador_mandato: identificador,
    p_documento_path: path,
    p_firma_imagen: firmaImagen,
    p_nombre_tecleado: nombreTecleado.trim(),
    p_texto_hash: textoHash,
    p_ip_address: ipAddress,
    p_user_agent: userAgent ?? '',
    p_fecha_firma: fechaFirmaIso,
    p_metodo: 'digital',
  } as never)
  if (rpcErr) {
    if (/no autorizado|42501/i.test(rpcErr.message)) return err('alta.errors.no_autorizado', 403)
    // No debería darse (solo llamamos registrar cuando NO hay activo), pero se propaga legible.
    if (/mandato_activo_otro_iban/i.test(rpcErr.message))
      return err('alta.sepa.errors.mandato_activo_otro_iban', 409)
    logger.warn('domiciliacion-tutor: rpc', rpcErr.message)
    return err('alta.sepa.errors.guardado', 500)
  }

  const url = await firmarRuta(supabase, BUCKET_MANDATO_SEPA, path)
  return Response.json({
    success: true,
    mandato: { identificador, documento: { path, url } },
  } satisfies RespuestaOk)
}
