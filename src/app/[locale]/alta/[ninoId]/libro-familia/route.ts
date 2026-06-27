import { randomUUID } from 'node:crypto'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { esTutorLegalDe } from '@/features/alta/lib/authz-tutor'
import { altaValidada, registrarCambioPendiente } from '@/features/cambios-pendientes/lib/gate'
import {
  BUCKET_LIBRO_FAMILIA,
  borrarObjetosBucket,
  firmarRuta,
} from '@/shared/lib/adjuntos/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Tope efectivo en app (el bucket también lo enforza a 10 MB). */
const MAX_PDF_BYTES = 10 * 1024 * 1024

interface RespuestaOk {
  success: true
  documento: { path: string; url: string | null }
  pendienteValidacion?: boolean
}
interface RespuestaError {
  success: false
  error: string
}

function err(error: string, status = 400): Response {
  return Response.json({ success: false, error } satisfies RespuestaError, { status })
}

/**
 * F11-G — subida del **libro de familia** (1 PDF/niño, bucket privado `libro-familia`).
 * El PDF lo construye el cliente (multi-imagen → `imagenesAPdf`). La subida va con el
 * cliente del USUARIO → la RLS de `storage.objects` (G-0: admin del centro o tutor legal
 * del niño) autoriza la escritura bajo `{centroId}/{ninoId}/...`. El `UPDATE` de
 * `ninos.libro_familia_path` (admin-only por RLS) se hace con **service role tras
 * autorizar** `es_tutor_legal_de` en app (no hay RPC ni RLS de tutor para esa columna).
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

  // Ficha visible para el usuario (RLS de `ninos`) → centro_id para la ruta + libro previo.
  const { data: nino } = await supabase
    .from('ninos')
    .select('id, centro_id, libro_familia_path')
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

  const path = `${nino.centro_id}/${nino.id}/${randomUUID()}.pdf`

  // 1. Subida con el cliente del usuario → la RLS de storage autoriza (admin/tutor).
  const subida = await supabase.storage
    .from(BUCKET_LIBRO_FAMILIA)
    .upload(path, file, { contentType: 'application/pdf', upsert: false })
  if (subida.error) {
    const msg = subida.error.message
    if (/row-level security|unauthorized|403/i.test(msg))
      return err('alta.errors.no_autorizado', 403)
    logger.warn('libro-familia: upload', msg)
    return err('alta.documentos.errors.subida', 500)
  }

  // 2. El UPDATE de `ninos.libro_familia_path` requiere service role (tabla admin-only).
  //    Se autoriza en app: solo tutor legal del niño. Si no, limpia el objeto subido.
  const autorizado = await esTutorLegalDe(supabase, nino.id, user.id)
  if (!autorizado) {
    await borrarObjetosBucket(supabase, BUCKET_LIBRO_FAMILIA, [path]).catch(() => undefined)
    return err('alta.errors.no_autorizado', 403)
  }

  // Decisión J: con el alta YA validada, el documento NO se aplica directo → cola de
  // validación. El PDF queda staged en su ruta; al aprobar se fija `libro_familia_path`.
  if (await altaValidada(supabase, nino.id)) {
    const r = await registrarCambioPendiente(supabase, {
      ninoId: nino.id,
      usuarioId: user.id,
      entidad: 'ninos_libro_familia',
      payload: { path },
    })
    if (!r.ok) {
      await borrarObjetosBucket(supabase, BUCKET_LIBRO_FAMILIA, [path]).catch(() => undefined)
      return err(r.error, 403)
    }
    const urlStaged = await firmarRuta(supabase, BUCKET_LIBRO_FAMILIA, path)
    return Response.json({
      success: true,
      documento: { path, url: urlStaged },
      pendienteValidacion: true,
    } satisfies RespuestaOk)
  }

  const service = createServiceRoleClient()
  const { error: updErr } = await service
    .from('ninos')
    .update({ libro_familia_path: path })
    .eq('id', nino.id)
  if (updErr) {
    await borrarObjetosBucket(service, BUCKET_LIBRO_FAMILIA, [path]).catch(() => undefined)
    logger.warn('libro-familia: update path', updErr.message)
    return err('alta.documentos.errors.subida', 500)
  }

  // 3. Limpia el libro anterior (sustitución; best-effort, sin huérfanos).
  if (nino.libro_familia_path && nino.libro_familia_path !== path) {
    await borrarObjetosBucket(service, BUCKET_LIBRO_FAMILIA, [nino.libro_familia_path]).catch(
      () => undefined
    )
  }

  const url = await firmarRuta(service, BUCKET_LIBRO_FAMILIA, path)
  return Response.json({ success: true, documento: { path, url } } satisfies RespuestaOk)
}
