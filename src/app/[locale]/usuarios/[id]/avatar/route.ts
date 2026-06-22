import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { FotoInvalidaError } from '@/features/fotos/lib/procesar-foto'
import { MAX_BYTES_ADJUNTO, procesarFotoAvatar } from '@/shared/lib/adjuntos/procesar-imagen'
import {
  BUCKET_USUARIOS_FOTOS,
  borrarObjetosBucket,
  firmarRutasBucket,
  rutaThumbDe,
  rutasConThumb,
} from '@/shared/lib/adjuntos/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RespuestaOk {
  success: true
  avatar: { path: string; url: string | null; urlMiniatura: string | null }
}
interface RespuestaError {
  success: false
  error: string
}

function err(error: string, status = 400): Response {
  return Response.json({ success: false, error } satisfies RespuestaError, { status })
}

/**
 * Subida + procesado server-side del **avatar de usuario** (F11-C-3, bucket privado
 * `usuarios-fotos`). Reusa el patrón F10-3 de la foto del niño.
 *
 * Autorización: la **subida va con el cliente del usuario** → la **RLS de
 * `storage.objects`** (F11-C-0: `es_admin([1]=centroId) OR [2]=usuarioId=auth.uid()`)
 * decide si puede escribir bajo `{centroId}/{usuarioId}/...`. Un 403 ahí significa "no
 * autorizado" (ni el propio usuario ni admin del centro). Solo el `UPDATE` de
 * `usuarios.foto_url` y la firma de las URLs se hacen con **service role TRAS** ese
 * gate (decisión B/D, ADR-0027): el upload exitoso ES la autorización. `sharp` quita
 * EXIF/GPS y normaliza a JPEG; HEIC se rechaza con mensaje claro (ADR-0046).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: usuarioId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(usuarioId)) return err('fotos.errors.subida_fallo')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('fotos.errors.no_autorizado', 401)

  // Derivar el `centroId` de la ruta. Self → cualquier centro del propio usuario (la
  // RLS valida por `[2]=usuarioId`). Admin sobre otro → un centro donde el solicitante
  // es admin y el usuario destino tiene rol (la RLS valida por `es_admin([1])`). La RLS
  // de Storage es el gate real; aquí solo elegimos un prefijo válido.
  const centroId =
    usuarioId === user.id
      ? await centroPropio(supabase, user.id)
      : await centroAdminCompartido(user.id, usuarioId)
  if (!centroId) return err('fotos.errors.no_autorizado', 403)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return err('fotos.errors.subida_fallo')
  }
  const file = form.get('file')
  if (!(file instanceof Blob)) return err('fotos.errors.subida_fallo')
  if (file.size > MAX_BYTES_ADJUNTO) return err('fotos.validation.tamano_max')

  // 1. Procesado (sharp). Lanza FotoInvalidaError con clave i18n.
  let procesada
  try {
    procesada = await procesarFotoAvatar(Buffer.from(await file.arrayBuffer()))
  } catch (e) {
    if (e instanceof FotoInvalidaError) return err(e.clave)
    logger.warn('usuarios/avatar: procesar', e instanceof Error ? e.message : 'desconocido')
    return err('fotos.errors.procesado_fallo', 500)
  }

  const rutas = rutasConThumb(`${centroId}/${usuarioId}`)

  // 2. Subida con el cliente del usuario → la RLS de storage autoriza (self/admin).
  const subirOriginal = await supabase.storage
    .from(BUCKET_USUARIOS_FOTOS)
    .upload(rutas.original, procesada.original, { contentType: 'image/jpeg', upsert: false })
  const subirMini = subirOriginal.error
    ? null
    : await supabase.storage
        .from(BUCKET_USUARIOS_FOTOS)
        .upload(rutas.miniatura, procesada.miniatura, { contentType: 'image/jpeg', upsert: false })

  if (subirOriginal.error || subirMini?.error) {
    const msg = subirOriginal.error?.message ?? subirMini?.error?.message ?? ''
    if (/row-level security|unauthorized|403/i.test(msg)) {
      await borrarObjetosBucket(supabase, BUCKET_USUARIOS_FOTOS, [rutas.original]).catch(
        () => undefined
      )
      return err('fotos.errors.no_autorizado', 403)
    }
    logger.warn('usuarios/avatar: upload', msg)
    return err('fotos.errors.subida_fallo', 500)
  }

  // 3. El UPDATE de `usuarios.foto_url` va por SERVICE-ROLE: la RLS de `usuarios` no
  //    deja al usuario tocar la columna, y el upload anterior ya autorizó (gate real).
  const service = createServiceRoleClient()
  const { data: anterior } = await service
    .from('usuarios')
    .select('foto_url')
    .eq('id', usuarioId)
    .maybeSingle()

  const { error: updErr } = await service
    .from('usuarios')
    .update({ foto_url: rutas.original })
    .eq('id', usuarioId)
  if (updErr) {
    await borrarObjetosBucket(service, BUCKET_USUARIOS_FOTOS, [
      rutas.original,
      rutas.miniatura,
    ]).catch(() => undefined)
    logger.warn('usuarios/avatar: update foto_url', updErr.message)
    return err('fotos.errors.subida_fallo', 500)
  }

  // Limpia el avatar anterior (best-effort) para no acumular huérfanos.
  if (anterior?.foto_url && anterior.foto_url !== rutas.original) {
    await borrarObjetosBucket(service, BUCKET_USUARIOS_FOTOS, [
      anterior.foto_url,
      rutaThumbDe(anterior.foto_url),
    ]).catch(() => undefined)
  }

  const firmadas = await firmarRutasBucket(service, BUCKET_USUARIOS_FOTOS, [
    rutas.original,
    rutas.miniatura,
  ])
  return Response.json({
    success: true,
    avatar: {
      path: rutas.original,
      url: firmadas.get(rutas.original) ?? null,
      urlMiniatura: firmadas.get(rutas.miniatura) ?? null,
    },
  } satisfies RespuestaOk)
}

/** Un centro al que pertenece el propio usuario (para el prefijo `{centroId}/`). */
async function centroPropio(
  supabase: Awaited<ReturnType<typeof createClient>>,
  usuarioId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('roles_usuario')
    .select('centro_id')
    .eq('usuario_id', usuarioId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  return data?.centro_id ?? null
}

/** Un centro donde el solicitante es admin y el usuario destino tiene rol. */
async function centroAdminCompartido(
  solicitanteId: string,
  destinoId: string
): Promise<string | null> {
  const supabase = await createClient()
  const { data: adminRoles } = await supabase
    .from('roles_usuario')
    .select('centro_id')
    .eq('usuario_id', solicitanteId)
    .eq('rol', 'admin')
    .is('deleted_at', null)
  const centrosAdmin = new Set((adminRoles ?? []).map((r) => r.centro_id))
  if (centrosAdmin.size === 0) return null

  // Lookup de los centros del destino por service-role (no es el dato principal; el
  // gate real sigue siendo la RLS de Storage al subir).
  const service = createServiceRoleClient()
  const { data: destinoRoles } = await service
    .from('roles_usuario')
    .select('centro_id')
    .eq('usuario_id', destinoId)
    .is('deleted_at', null)
  return (destinoRoles ?? []).map((r) => r.centro_id).find((c) => centrosAdmin.has(c)) ?? null
}
