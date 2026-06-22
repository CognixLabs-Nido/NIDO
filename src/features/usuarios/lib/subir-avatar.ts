/**
 * Cliente del endpoint de avatar (F11-C-3). POST multipart a la route handler
 * `/{locale}/usuarios/{usuarioId}/avatar` (no server action: el binario de hasta 4 MB
 * excede el límite de body de las server actions). Devuelve la URL firmada o una clave
 * i18n de error para que la UI la traduzca con `safeTranslate`.
 */
export interface AvatarSubido {
  ok: true
  url: string | null
  urlMiniatura: string | null
}
export interface AvatarError {
  ok: false
  error: string
}

export async function subirAvatar(
  locale: string,
  usuarioId: string,
  file: File
): Promise<AvatarSubido | AvatarError> {
  const body = new FormData()
  body.set('file', file)
  let res: Response
  try {
    res = await fetch(`/${locale}/usuarios/${usuarioId}/avatar`, { method: 'POST', body })
  } catch {
    return { ok: false, error: 'fotos.errors.subida_fallo' }
  }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, error: 'fotos.errors.subida_fallo' }
  }
  const data = json as {
    success?: boolean
    error?: string
    avatar?: { url?: string | null; urlMiniatura?: string | null }
  }
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error ?? 'fotos.errors.subida_fallo' }
  }
  return {
    ok: true,
    url: data.avatar?.url ?? null,
    urlMiniatura: data.avatar?.urlMiniatura ?? null,
  }
}
