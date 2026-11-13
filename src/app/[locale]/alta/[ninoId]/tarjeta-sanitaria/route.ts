import { randomUUID } from 'node:crypto'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { registrarCambioPendiente } from '@/features/cambios-pendientes/lib/gate'
import { BUCKET_SIP_NINOS, borrarObjetosBucket, firmarRuta } from '@/shared/lib/adjuntos/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Tope efectivo en app (el bucket también lo enforza a 10 MB). */
const MAX_PDF_BYTES = 10 * 1024 * 1024

interface RespuestaOk {
  success: true
  documento: { path: string; url: string | null }
  pendienteValidacion?: boolean
}

function err(error: string, status = 400): Response {
  return Response.json({ success: false, error }, { status })
}

/**
 * Fase 7 (D8 y decisión del 2026-11-13): la imagen de la tarjeta sanitaria del niño, anverso y
 * reverso en un PDF (lo arma el cliente, como el DNI de los tutores), en su bucket `sip-ninos`. La
 * suben la familia o la Dirección, después del alta, y no es obligatoria nunca.
 *
 * La subida va con el cliente del USUARIO (la RLS del bucket: Dirección o tutor legal, ruta del
 * niño). La ruta la fija `fijar_sip_documento_nino` con la sesión, que decide la puerta: con el alta
 * validada, el tutor recibe 42501 `cola_validacion` y entonces la app encola (`ninos_sip_documento`)
 * con el PDF ya subido; al aprobar, la Dirección fija la ruta. Como el DNI del tutor (fase 6): la app
 * encola cuando la base lo dice, no por su cuenta. El service role, solo para Storage.
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
  if (!(file instanceof Blob)) return err('alta.documentos.errors.subida')
  if (file.type !== 'application/pdf') return err('alta.documentos.errors.tipo_pdf')
  if (file.size > MAX_PDF_BYTES) return err('alta.documentos.errors.tamano')

  const path = `${nino.centro_id}/${nino.id}/sip-${randomUUID()}.pdf`
  const service = createServiceRoleClient()

  // 1. Subida con el cliente del usuario: la RLS del bucket autoriza (Dirección o tutor legal).
  const subida = await supabase.storage
    .from(BUCKET_SIP_NINOS)
    .upload(path, file, { contentType: 'application/pdf', upsert: false })
  if (subida.error) {
    const msg = subida.error.message
    if (/row-level security|unauthorized|403/i.test(msg))
      return err('alta.errors.no_autorizado', 403)
    logger.warn('tarjeta-sanitaria: upload', msg)
    return err('alta.documentos.errors.subida', 500)
  }

  // 2. La base fija la ruta, o dice que va a la cola.
  const { data: anterior, error: fijarError } = await supabase.rpc('fijar_sip_documento_nino', {
    p_nino_id: nino.id,
    p_path: path,
  })
  if (fijarError) {
    if (fijarError.code === '42501' && fijarError.hint === 'cola_validacion') {
      const r = await registrarCambioPendiente(supabase, {
        ninoId: nino.id,
        usuarioId: user.id,
        entidad: 'ninos_sip_documento',
        payload: { path },
      })
      if (!r.ok) {
        await borrarObjetosBucket(service, BUCKET_SIP_NINOS, [path]).catch(() => undefined)
        return err(r.error, 403)
      }
      const urlStaged = await firmarRuta(service, BUCKET_SIP_NINOS, path)
      return Response.json({
        success: true,
        documento: { path, url: urlStaged },
        pendienteValidacion: true,
      } satisfies RespuestaOk)
    }
    await borrarObjetosBucket(service, BUCKET_SIP_NINOS, [path]).catch(() => undefined)
    if (fijarError.code === '42501') return err('alta.errors.no_autorizado', 403)
    logger.warn('tarjeta-sanitaria: fijar_sip_documento_nino', fijarError.code ?? 'sin_codigo')
    return err('alta.documentos.errors.subida', 500)
  }

  // 3. La imagen anterior ya no la usa nadie: se borra (best-effort).
  if (anterior && anterior !== path) {
    await borrarObjetosBucket(service, BUCKET_SIP_NINOS, [anterior]).catch(() => undefined)
  }
  const url = await firmarRuta(service, BUCKET_SIP_NINOS, path)
  return Response.json({ success: true, documento: { path, url } } satisfies RespuestaOk)
}
