import { createHash, randomUUID } from 'node:crypto'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { esTutorLegalDe } from '@/features/alta/lib/authz-tutor'
import { ibanValido, normalizarIban } from '@/features/alta/lib/iban'
import { MAX_LARGO_IDENTIFICADOR, textoCanonicoMandato } from '@/features/alta/lib/mandato-sepa'
import { BUCKET_MANDATO_SEPA, borrarObjetosBucket, firmarRuta } from '@/shared/lib/adjuntos/storage'

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
 * F11-G-2 — alta del **mandato SEPA Core** (paso 8 del wizard). El tutor 1 (titular) firma
 * con trazo; el cliente genera el PDF (jsPDF) y lo envía aquí junto al IBAN, el titular, el
 * identificador único y el trazo. La subida del PDF va con el cliente del USUARIO (la RLS de
 * `storage.objects` del bucket `mandato-sepa` autoriza al tutor legal bajo `{centroId}/{ninoId}`).
 * La fila de `mandatos_sepa` (firma auto-contenida + `texto_hash` recalculado en servidor) se
 * escribe con **service role tras autorizar** `es_tutor_legal_de` (patrón #108, sin migración):
 * mantiene la escritura atómica y server-controlada (hash, IP/UA, fecha). Re-enviar reemplaza
 * el mandato activo del tutor (limpia el PDF previo).
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
  const path = `${nino.centro_id}/${nino.id}/mandato-${randomUUID()}.pdf`

  // 1. Subida del PDF con el cliente del usuario → la RLS de storage autoriza (admin/tutor).
  const subida = await supabase.storage
    .from(BUCKET_MANDATO_SEPA)
    .upload(path, file, { contentType: 'application/pdf', upsert: false })
  if (subida.error) {
    const msg = subida.error.message
    if (/row-level security|unauthorized|403/i.test(msg))
      return err('alta.errors.no_autorizado', 403)
    logger.warn('mandato-sepa: upload', msg)
    return err('alta.documentos.errors.subida', 500)
  }

  // 2. La fila va por service role; se autoriza en app: solo tutor legal del niño.
  const autorizado = await esTutorLegalDe(supabase, nino.id, user.id)
  if (!autorizado) {
    await borrarObjetosBucket(supabase, BUCKET_MANDATO_SEPA, [path]).catch(() => undefined)
    return err('alta.errors.no_autorizado', 403)
  }

  const service = createServiceRoleClient()

  // Acreedor = centro (nombre + dirección) para el canónico que se hashea.
  const { data: centro } = await service
    .from('centros')
    .select('nombre, direccion')
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

  const ipAddress = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null
  const userAgent = request.headers.get('user-agent')?.slice(0, 500) ?? null

  const fila = {
    iban,
    titular: titular.trim(),
    identificador_mandato: identificador,
    documento_path: path,
    estado: 'activo' as const,
    firma_imagen: firmaImagen,
    nombre_tecleado: nombreTecleado.trim(),
    texto_hash: textoHash,
    ip_address: ipAddress,
    user_agent: userAgent,
    fecha_firma: fechaFirmaIso,
  }

  // Reemplaza el mandato activo del tutor (1 por nino+usuario); si no hay, lo crea.
  const { data: existente } = await service
    .from('mandatos_sepa')
    .select('id, documento_path')
    .eq('nino_id', nino.id)
    .eq('usuario_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  let docPrevio: string | null = null
  if (existente) {
    docPrevio = existente.documento_path
    const { error: updErr } = await service
      .from('mandatos_sepa')
      .update(fila)
      .eq('id', existente.id)
    if (updErr) {
      await borrarObjetosBucket(service, BUCKET_MANDATO_SEPA, [path]).catch(() => undefined)
      logger.warn('mandato-sepa: update', updErr.message)
      return err('alta.sepa.errors.guardado', 500)
    }
  } else {
    const { error: insErr } = await service.from('mandatos_sepa').insert({
      centro_id: nino.centro_id,
      nino_id: nino.id,
      usuario_id: user.id,
      ...fila,
    })
    if (insErr) {
      await borrarObjetosBucket(service, BUCKET_MANDATO_SEPA, [path]).catch(() => undefined)
      logger.warn('mandato-sepa: insert', insErr.message)
      return err('alta.sepa.errors.guardado', 500)
    }
  }

  // Limpia el PDF anterior (sustitución; best-effort, sin huérfanos).
  if (docPrevio && docPrevio !== path) {
    await borrarObjetosBucket(service, BUCKET_MANDATO_SEPA, [docPrevio]).catch(() => undefined)
  }

  const url = await firmarRuta(service, BUCKET_MANDATO_SEPA, path)
  return Response.json({
    success: true,
    mandato: { identificador, documento: { path, url } },
  } satisfies RespuestaOk)
}
