import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { BUCKET_MANDATO_SEPA } from '@/shared/lib/adjuntos/storage'
import { logger } from '@/shared/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ORIGENES = ['alta', 'ficha', 'recibos', 'export'] as const

function noDisponible(status: number): Response {
  return new Response(status === 404 ? 'Not found' : 'Unavailable', {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

/**
 * El PDF de un mandato SEPA, SIN ENLACE (2026-11-22, cierre del mandato: «Sin enlace, como la 10c.
 * Copia ese mecanismo entero, incluida la fila de lectura antes de servir»). Ninguna página firma un
 * enlace al pintarse: el botón trae aquí. Quién puede lo decide la base, `abrir_documento_mandato`,
 * que deja la lectura en `lecturas_mandato_sepa` ANTES de que esta ruta lea un solo byte; después,
 * los bytes se leen con la MISMA sesión (la RLS de Storage vuelve a mirar) y se entregan sin caché.
 * No queda ninguna URL que alguien pueda reenviar. El export enlaza a esta misma ruta.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string; mandatoId: string }> }
): Promise<Response> {
  const { mandatoId } = await params
  if (!z.string().uuid().safeParse(mandatoId).success) return noDisponible(404)
  const origenParam = new URL(request.url).searchParams.get('origen')
  const origen = ORIGENES.find((o) => o === origenParam) ?? 'ficha'

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('abrir_documento_mandato', {
    p_mandato_id: mandatoId,
    p_origen: origen,
  })
  // Uno que no existe y uno ajeno contestan lo mismo (42501): no se dice cuál es.
  if (error) return noDisponible(error.code === '42501' ? 404 : 500)
  const fila = data?.[0]
  // La función no devuelve un mandato sin documento (42501); el tipo no lo sabe.
  if (!fila?.documento_path) return noDisponible(404)

  const { data: blob, error: errBytes } = await supabase.storage
    .from(BUCKET_MANDATO_SEPA)
    .download(fila.documento_path)
  if (errBytes || !blob) {
    // La lectura ya quedó apuntada: abrir y no ver es un fallo que se ve, no un hueco.
    logger.error('mandato: lectura apuntada sin bytes', errBytes?.message ?? 'sin bytes')
    return noDisponible(500)
  }
  return new Response(Buffer.from(await blob.arrayBuffer()), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="mandato-sepa-${fila.identificador_mandato ?? mandatoId}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
