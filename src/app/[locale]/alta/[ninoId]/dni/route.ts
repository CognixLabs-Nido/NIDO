import { randomUUID } from 'node:crypto'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { BUCKET_DNI_TUTORES, borrarObjetosBucket, firmarRuta } from '@/shared/lib/adjuntos/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_PDF_BYTES = 10 * 1024 * 1024
const VINCULOS_LEGALES = ['tutor_legal_principal', 'tutor_legal_secundario'] as const

interface RespuestaOk {
  success: true
  documento: { path: string; url: string | null }
}
interface RespuestaError {
  success: false
  error: string
}

function err(error: string, status = 400): Response {
  return Response.json({ success: false, error } satisfies RespuestaError, { status })
}

/**
 * F11-G — subida del **DNI de un tutor** (1 PDF, 2 caras → `imagenesAPdf`; bucket privado
 * `dni-tutores`). `tipo_vinculo` distingue tutor 1 (`tutor_legal_principal`) de tutor 2
 * (`tutor_legal_secundario`, sin cuenta). La subida y el set de `datos_tutor.dni_documento_path`
 * van con el cliente del USUARIO: la RLS de storage y de `datos_tutor` (`es_admin OR
 * es_tutor_legal_de`) autorizan al tutor legal del niño. No toca el resto de columnas de la
 * fila (la identidad la fija `guardarDatosTutor`), así que el orden de pasos es indiferente.
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
  const tipoVinculo = form.get('tipo_vinculo')
  if (!(file instanceof Blob)) return err('alta.documentos.errors.subida')
  if (
    typeof tipoVinculo !== 'string' ||
    !(VINCULOS_LEGALES as readonly string[]).includes(tipoVinculo)
  ) {
    return err('alta.documentos.errors.datos_invalidos')
  }
  const tv = tipoVinculo as (typeof VINCULOS_LEGALES)[number]
  if (file.type !== 'application/pdf') return err('alta.documentos.errors.tipo_pdf')
  if (file.size > MAX_PDF_BYTES) return err('alta.documentos.errors.tamano')

  const path = `${nino.centro_id}/${nino.id}/dni-${tv}-${randomUUID()}.pdf`

  const subida = await supabase.storage
    .from(BUCKET_DNI_TUTORES)
    .upload(path, file, { contentType: 'application/pdf', upsert: false })
  if (subida.error) {
    const msg = subida.error.message
    if (/row-level security|unauthorized|403/i.test(msg))
      return err('alta.errors.no_autorizado', 403)
    logger.warn('dni: upload', msg)
    return err('alta.documentos.errors.subida', 500)
  }

  // Fija dni_documento_path en la fila (nino, tipo_vinculo); crea la fila si no existía.
  const usuarioId = tv === 'tutor_legal_principal' ? user.id : null
  const { data: existente } = await supabase
    .from('datos_tutor')
    .select('id, dni_documento_path')
    .eq('nino_id', nino.id)
    .eq('tipo_vinculo', tv)
    .is('deleted_at', null)
    .maybeSingle()

  let filaError: string | null = null
  let dniPrevio: string | null = null
  if (existente) {
    dniPrevio = existente.dni_documento_path
    const { error } = await supabase
      .from('datos_tutor')
      .update({ dni_documento_path: path })
      .eq('id', existente.id)
    filaError = error?.message ?? null
  } else {
    const { error } = await supabase.from('datos_tutor').insert({
      centro_id: nino.centro_id,
      nino_id: nino.id,
      tipo_vinculo: tv,
      usuario_id: usuarioId,
      dni_documento_path: path,
    })
    filaError = error?.message ?? null
  }

  if (filaError) {
    await borrarObjetosBucket(supabase, BUCKET_DNI_TUTORES, [path]).catch(() => undefined)
    if (/row-level security|42501/i.test(filaError)) return err('alta.errors.no_autorizado', 403)
    logger.warn('dni: set path', filaError)
    return err('alta.documentos.errors.subida', 500)
  }

  // Limpia el DNI anterior (sustitución; best-effort).
  if (dniPrevio && dniPrevio !== path) {
    await borrarObjetosBucket(supabase, BUCKET_DNI_TUTORES, [dniPrevio]).catch(() => undefined)
  }

  const url = await firmarRuta(supabase, BUCKET_DNI_TUTORES, path)
  return Response.json({ success: true, documento: { path, url } } satisfies RespuestaOk)
}
