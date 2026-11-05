import { z } from 'zod'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

import { enlaceVersionDocumento } from '@/features/documentos-centro/lib/versiones'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const uuid = z.string().uuid()

/**
 * Abre el PDF de una versión (1c): la admin del centro, con un enlace firmado de un minuto. Quién
 * puede y qué ruta es lo decide `enlaceVersionDocumento`, desde la lista de la admin.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params
  const centroId = new URL(request.url).searchParams.get('centro')
  if (!uuid.safeParse(id).success || !uuid.safeParse(centroId).success)
    return Response.json(
      { success: false, error: 'documentos_centro.errors.invalido' },
      { status: 400 }
    )

  const r = await enlaceVersionDocumento(
    await createClient(),
    createServiceRoleClient(),
    centroId as string,
    id
  )
  if (!r.ok)
    return Response.json(
      { success: false, error: r.error },
      { status: r.error.endsWith('.no_autorizado') ? 403 : 400 }
    )
  return Response.redirect(r.data.url, 303)
}
