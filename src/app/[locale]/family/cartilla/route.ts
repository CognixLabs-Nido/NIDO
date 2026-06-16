import { guardarInfoMedicaTutor } from '@/features/ninos/actions/guardar-info-medica-tutor'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { FotoInvalidaError } from '@/features/fotos/lib/procesar-foto'
import { MAX_BYTES_ADJUNTO, procesarDocumento } from '@/shared/lib/adjuntos/procesar-imagen'
import {
  BUCKET_CARTILLA_VACUNAS,
  borrarObjetosBucket,
  firmarRutasBucket,
  rutasConThumb,
} from '@/shared/lib/adjuntos/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RespuestaOk {
  success: true
  cartilla: { path: string; url: string | null; urlMiniatura: string | null }
}
interface RespuestaError {
  success: false
  error: string
}

function err(error: string, status = 400): Response {
  return Response.json({ success: false, error } satisfies RespuestaError, { status })
}

/**
 * Subida + procesado de la **cartilla de vacunas** (Pieza 3b-1; bucket privado
 * `cartilla-vacunas`). La sube el **tutor** en el paso médico del wizard, SOLO con
 * consentimiento `datos_medicos` vigente: la **RLS de `storage.objects`** (3a
 * `cartilla_tutor_insert` = `es_tutor_de([2]) AND tiene_consentimiento(...)`) autoriza
 * la subida; ni el fichero entra sin consentimiento. Tras subir, la ruta se persiste
 * en `info_medica_emergencia.cartilla_vacunas_path` vía `guardarInfoMedicaTutor` (la
 * RPC gateada de 3a — única puerta de escritura del tutor a la tabla médica).
 *
 * Ruta `{centroId}/{ninoId}/...`. Documento legible → compresión leve (EXIF/GPS fuera);
 * HEIC se rechaza con mensaje claro (como F10).
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('autorizaciones.errors.no_autorizado', 401)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return err('fotos.errors.subida_fallo')
  }
  const file = form.get('file')
  const ninoId = form.get('nino_id')
  if (!(file instanceof Blob) || typeof ninoId !== 'string') return err('fotos.errors.subida_fallo')
  if (file.size > MAX_BYTES_ADJUNTO) return err('fotos.validation.tamano_max')

  // Ficha del niño (RLS: el tutor la ve) → centro_id para la ruta.
  const { data: nino } = await supabase
    .from('ninos')
    .select('id, centro_id')
    .eq('id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!nino) return err('autorizaciones.errors.no_es_tutor', 403)

  // 1. Procesado (sharp). Lanza FotoInvalidaError con clave i18n.
  let procesada
  try {
    procesada = await procesarDocumento(Buffer.from(await file.arrayBuffer()))
  } catch (e) {
    if (e instanceof FotoInvalidaError) return err(e.clave)
    logger.warn('family/cartilla: procesar', e instanceof Error ? e.message : 'desconocido')
    return err('fotos.errors.procesado_fallo', 500)
  }

  const rutas = rutasConThumb(`${nino.centro_id}/${nino.id}`)

  // 2. Subida con el cliente del usuario → la RLS de storage autoriza (tutor + consent).
  const subirOriginal = await supabase.storage
    .from(BUCKET_CARTILLA_VACUNAS)
    .upload(rutas.original, procesada.original, { contentType: 'image/jpeg', upsert: true })
  const subirMini = subirOriginal.error
    ? null
    : await supabase.storage
        .from(BUCKET_CARTILLA_VACUNAS)
        .upload(rutas.miniatura, procesada.miniatura, { contentType: 'image/jpeg', upsert: true })

  if (subirOriginal.error || subirMini?.error) {
    const msg = subirOriginal.error?.message ?? subirMini?.error?.message ?? ''
    if (/row-level security|unauthorized|403/i.test(msg)) {
      // Sin consentimiento de datos médicos o sin tutela → la RLS rechaza.
      await borrarObjetosBucket(supabase, BUCKET_CARTILLA_VACUNAS, [rutas.original]).catch(
        () => undefined
      )
      return err('nino.errors.medica_no_autorizado', 403)
    }
    logger.warn('family/cartilla: upload', msg)
    return err('fotos.errors.subida_fallo', 500)
  }

  // 3. Persiste la ruta vía la RPC médica del tutor (gateada por consentimiento).
  const guardado = await guardarInfoMedicaTutor({
    nino_id: nino.id,
    cartilla_vacunas_path: rutas.original,
  })
  if (!guardado.success) {
    // No deja huérfano: si la RPC rechaza (p. ej. consent revocado entre medias), borra.
    await borrarObjetosBucket(supabase, BUCKET_CARTILLA_VACUNAS, [
      rutas.original,
      rutas.miniatura,
    ]).catch(() => undefined)
    return err(guardado.error, 403)
  }

  const firmadas = await firmarRutasBucket(supabase, BUCKET_CARTILLA_VACUNAS, [
    rutas.original,
    rutas.miniatura,
  ])
  return Response.json({
    success: true,
    cartilla: {
      path: rutas.original,
      url: firmadas.get(rutas.original) ?? null,
      urlMiniatura: firmadas.get(rutas.miniatura) ?? null,
    },
  } satisfies RespuestaOk)
}
