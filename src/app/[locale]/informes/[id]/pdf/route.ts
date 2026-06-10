import { createClient, createServiceClient } from '@/lib/supabase/server'

import { generarInformePdf } from '@/features/informes/lib/informe-pdf'
import {
  assembleInformePdfData,
  loadInformeParaPdf,
} from '@/features/informes/queries/get-informe-pdf-data'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Descarga del PDF de un informe de evolución PUBLICADO (F9-4, Q11: server-side).
 * Ruta neutra de rol: la **RLS de F9-0** decide el acceso (un tutor solo baja el PDF
 * del informe de su hijo y solo publicado; staff del aula también). Si no es
 * accesible o no está publicado → 404. La familia es el caso principal, pero
 * profe/admin enlazan a la misma ruta reusando el generador.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; id: string }> }
): Promise<Response> {
  const { id } = await params

  // 1. Autorización: lectura con el cliente del usuario (RLS).
  const supabase = await createClient()
  const row = await loadInformeParaPdf(supabase, id)
  if (!row) return new Response('Not found', { status: 404 })

  // 2. Metadatos (centro/curso/autor) con service role, ya autorizado.
  const service = await createServiceClient()
  const data = await assembleInformePdfData(service, row)

  // 3. Generación.
  const bytes = await generarInformePdf(data)

  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="informe-evolucion-${row.periodo}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
