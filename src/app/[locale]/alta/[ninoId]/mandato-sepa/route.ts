import { createHash } from 'node:crypto'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

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
 * F11-G-2 (cifrado en G-2bis) — alta del **mandato SEPA Core** (paso 8 del wizard). El tutor 1
 * (titular) firma con trazo; el cliente genera el PDF (jsPDF) y lo envía aquí junto al IBAN, el
 * titular, el identificador único y el trazo. Todo va con el **cliente del USUARIO**:
 *  - el PDF se sube al bucket `mandato-sepa` en una ruta DETERMINISTA `{centroId}/{ninoId}/mandato.pdf`
 *    con `upsert` (la RLS de storage autoriza al tutor legal; re-firmar sobrescribe, sin huérfanos),
 *  - la fila de `mandatos_sepa` se persiste vía RPC `registrar_mandato_sepa` (SECURITY DEFINER) que
 *    **autoriza `es_tutor_legal_de` y CIFRA el IBAN** antes del upsert → el route ya NO usa
 *    service-role (#108).
 * El `texto_hash` se calcula aquí (servidor) sobre el IBAN **en claro del formulario** (ancla el
 * contenido firmado, independiente del cifrado en reposo). El IBAN nunca se almacena en claro.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ ninoId: string }> }
): Promise<Response> {
  const { ninoId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('alta.errors.no_autorizado', 401)

  const { data: nino } = await supabase
    .from('ninos')
    .select('id, centro_id')
    .eq('id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!nino) return err('alta.errors.no_autorizado', 403)

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
  if (
    typeof firmaImagen !== 'string' ||
    !firmaImagen.startsWith('data:image/') ||
    firmaImagen.length > MAX_FIRMA_CHARS
  )
    return err('alta.sepa.errors.firma')

  const iban = normalizarIban(ibanRaw)
  // Ruta determinista (1 mandato por niño): re-firmar sobrescribe, sin huérfanos.
  const path = `${nino.centro_id}/${nino.id}/mandato.pdf`

  // Acreedor = centro (nombre) para el canónico que se hashea. Lo lee el cliente de usuario
  // (RLS `centros`: pertenece_a_centro → el tutor lo ve).
  const { data: centro } = await supabase
    .from('centros')
    .select('nombre')
    .eq('id', nino.centro_id)
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

  // 1. Subida del PDF (cliente de usuario; RLS de storage autoriza al tutor). `upsert` para
  //    sobrescribir en re-firma sin necesitar DELETE (que es admin-only en este bucket).
  const subida = await supabase.storage
    .from(BUCKET_MANDATO_SEPA)
    .upload(path, file, { contentType: 'application/pdf', upsert: true })
  if (subida.error) {
    const msg = subida.error.message
    if (/row-level security|unauthorized|403/i.test(msg))
      return err('alta.errors.no_autorizado', 403)
    logger.warn('mandato-sepa: upload', msg)
    return err('alta.documentos.errors.subida', 500)
  }

  // 2. Fila vía RPC SECURITY DEFINER: autoriza es_tutor_legal_de y CIFRA el IBAN antes del
  //    upsert (sin service-role). El IBAN en claro solo viaja como parámetro, nunca se almacena.
  const ipAddress = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null
  const userAgent = request.headers.get('user-agent')?.slice(0, 500) ?? null

  const { error: rpcErr } = await supabase.rpc('registrar_mandato_sepa', {
    p_nino_id: nino.id,
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
  })
  if (rpcErr) {
    // El PDF queda en su ruta determinista (se sobrescribe en el próximo intento).
    if (/no autorizado|42501/i.test(rpcErr.message)) return err('alta.errors.no_autorizado', 403)
    logger.warn('mandato-sepa: rpc', rpcErr.message)
    return err('alta.sepa.errors.guardado', 500)
  }

  const url = await firmarRuta(supabase, BUCKET_MANDATO_SEPA, path)
  return Response.json({
    success: true,
    mandato: { identificador, documento: { path, url } },
  } satisfies RespuestaOk)
}
