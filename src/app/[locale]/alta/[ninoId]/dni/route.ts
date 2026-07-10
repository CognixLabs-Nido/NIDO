import { randomUUID } from 'node:crypto'

import { createClient } from '@/lib/supabase/server'
import { altaValidada, registrarCambioPendiente } from '@/features/cambios-pendientes/lib/gate'
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
 * (`tutor_legal_secundario`, sin cuenta). La subida y el set de
 * `familia_tutores.dni_documento_path` (perfil COMPARTIDO por familia, F-2b-3) van con el
 * cliente del USUARIO: la RLS de storage y la de tutor sobre `familia_tutores`
 * (`es_tutor_de_familia`) autorizan al tutor del niño. Solo toca `dni_documento_path` (la
 * identidad la fija `guardarDatosTutor`), así que el orden de pasos es indiferente.
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

  // Decisión J: con el alta YA validada, el documento NO se aplica directo → cola de
  // validación. El PDF queda staged; al aprobar se fija `dni_documento_path`.
  if (await altaValidada(supabase, nino.id)) {
    const r = await registrarCambioPendiente(supabase, {
      ninoId: nino.id,
      usuarioId: user.id,
      entidad: 'datos_tutor_dni',
      payload: { tipo_vinculo: tv, path },
    })
    if (!r.ok) {
      await borrarObjetosBucket(supabase, BUCKET_DNI_TUTORES, [path]).catch(() => undefined)
      return err(r.error, 403)
    }
    const urlStaged = await firmarRuta(supabase, BUCKET_DNI_TUTORES, path)
    return Response.json({
      success: true,
      documento: { path, url: urlStaged },
      pendienteValidacion: true,
    } satisfies RespuestaOk)
  }

  // Fija dni_documento_path en la fila (familia, rol_familia) del perfil COMPARTIDO
  // `familia_tutores`; crea la del segundo_tutor si aún no existía. El titular ya tiene fila
  // (RPC de alta) → siempre UPDATE. Solo se toca `dni_documento_path` → el congelado (BEFORE
  // UPDATE de usuario_id/familia_id/rol_familia) no salta.
  const rolFamilia = rolFamiliaDeVinculo(tv)
  const { data: existente } = await supabase
    .from('familia_tutores')
    .select('id, dni_documento_path')
    .eq('familia_id', nino.familia_id)
    .eq('rol_familia', rolFamilia)
    .is('deleted_at', null)
    .maybeSingle()

  let filaError: string | null = null
  let dniPrevio: string | null = null
  if (existente) {
    dniPrevio = existente.dni_documento_path
    const { error } = await supabase
      .from('familia_tutores')
      .update({ dni_documento_path: path })
      .eq('id', existente.id)
    filaError = error?.message ?? null
  } else if (rolFamilia === 'segundo_tutor') {
    // segundo_tutor sin identidad aún (DNI antes que datos): INSERT con usuario_id NULL.
    const { error } = await supabase.from('familia_tutores').insert({
      familia_id: nino.familia_id,
      rol_familia: 'segundo_tutor',
      usuario_id: null,
      dni_documento_path: path,
    })
    filaError = error?.message ?? null
  } else {
    // Titular sin fila = estado anómalo (la RPC de alta la crea). No se inserta un titular.
    filaError = 'titular_sin_fila'
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
