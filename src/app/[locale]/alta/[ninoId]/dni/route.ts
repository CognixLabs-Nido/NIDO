import { randomUUID } from 'node:crypto'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { registrarCambioPendiente } from '@/features/cambios-pendientes/lib/gate'
import { rolFamiliaDeVinculo } from '@/features/alta/schemas/alta-documentos'
import { logger } from '@/shared/lib/logger'

import { BUCKET_DNI_TUTORES, borrarObjetosBucket, firmarRuta } from '@/shared/lib/adjuntos/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_PDF_BYTES = 10 * 1024 * 1024
const VINCULOS_LEGALES = ['tutor_legal_principal', 'tutor_legal_secundario'] as const

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
 * F11-G — subida del **DNI de un tutor** (1 PDF, 2 caras → `imagenesAPdf`; bucket privado
 * `dni-tutores`). `tipo_vinculo` distingue tutor 1 (`tutor_legal_principal`) de tutor 2
 * (`tutor_legal_secundario`). La subida va con el cliente del USUARIO (la RLS de storage) y la ruta
 * se fija por `fijar_dni_tutor` (fase 6), en el perfil COMPARTIDO por familia. Solo toca
 * `dni_documento_path` (la identidad la fija `guardarDatosTutor`): el orden de pasos es indiferente.
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
    .select('id, centro_id, familia_id')
    .eq('id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!nino?.familia_id) return err('alta.errors.no_autorizado', 403)

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

  // Fase 6 (`20270118120000`): la ruta se fija por `fijar_dni_tutor`, que aplica la regla única (el
  // DNI del otro tutor, solo mientras no tiene cuenta) y la cola POR FAMILIA: con el alta de la familia
  // validada devuelve HINT `cola_validacion`, y el PDF queda staged en la cola. Lo decide la base: por
  // niño, el alta de un hermano sin validar se saltaba la cola (medido el 2026-11-13).
  // Lo que no llega a engancharse se borra con el cliente de servicio: la sesión no borra en el bucket.
  const service = createServiceRoleClient()
  const descartar = () =>
    borrarObjetosBucket(service, BUCKET_DNI_TUTORES, [path]).catch(() => undefined)
  const { data: dniPrevio, error: fijarError } = await supabase.rpc('fijar_dni_tutor', {
    p_familia_id: nino.familia_id,
    p_rol_familia: rolFamiliaDeVinculo(tv),
    p_path: path,
  })

  if (fijarError?.hint === 'cola_validacion') {
    const r = await registrarCambioPendiente(supabase, {
      ninoId: nino.id,
      usuarioId: user.id,
      entidad: 'datos_tutor_dni',
      payload: { tipo_vinculo: tv, path },
    })
    if (!r.ok) {
      await descartar()
      return err(r.error, 403)
    }
    const urlStaged = await firmarRuta(supabase, BUCKET_DNI_TUTORES, path)
    return Response.json({
      success: true,
      documento: { path, url: urlStaged },
      pendienteValidacion: true,
    } satisfies RespuestaOk)
  }

  if (fijarError) {
    await descartar()
    if (fijarError.code === '42501') return err('alta.errors.no_autorizado', 403)
    logger.warn('dni: fijar_dni_tutor', fijarError.code ?? 'sin_codigo')
    if (fijarError.hint === 'titular_sin_fila')
      return err('alta.documentos.errors.tutor_duplicado', 409)
    return err('alta.documentos.errors.subida', 500)
  }

  // Limpia el DNI anterior (sustitución; best-effort).
  if (dniPrevio && dniPrevio !== path) {
    await borrarObjetosBucket(service, BUCKET_DNI_TUTORES, [dniPrevio]).catch(() => undefined)
  }

  const url = await firmarRuta(supabase, BUCKET_DNI_TUTORES, path)
  return Response.json({ success: true, documento: { path, url } } satisfies RespuestaOk)
}
