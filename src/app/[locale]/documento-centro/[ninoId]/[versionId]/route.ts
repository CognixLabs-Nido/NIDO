import { z } from 'zod'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

import { enlaceDocumentoNino } from '@/features/documentos-centro/lib/firmar-documentos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const uuid = z.string().uuid()

/**
 * Abre el PDF de un documento del centro que le toca a un niño (fase 4: el alta, 4b-1, y la ficha,
 * 4c), con un enlace firmado de un minuto. Qué versión puede abrir quién lo decide la base
 * (`enlaceDocumentoNino`).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ninoId: string; versionId: string }> }
): Promise<Response> {
  const { ninoId, versionId } = await params
  if (!uuid.safeParse(ninoId).success || !uuid.safeParse(versionId).success)
    return Response.json(
      { success: false, error: 'firmar_documentos.errors.invalido' },
      { status: 400 }
    )
  const r = await enlaceDocumentoNino(
    await createClient(),
    createServiceRoleClient(),
    ninoId,
    versionId
  )
  if (!r.ok)
    return Response.json(
      { success: false, error: r.error },
      { status: r.error.endsWith('.no_autorizado') ? 403 : 400 }
    )
  return Response.redirect(r.data.url, 303)
}
