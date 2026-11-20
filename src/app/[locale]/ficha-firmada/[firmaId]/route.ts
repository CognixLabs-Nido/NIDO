import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'

import { componerFichaFirmada } from '@/features/alta/lib/ficha-pdf'
import { leerFichaFirmada } from '@/features/alta/lib/leer-ficha-firmada'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * La copia firmada de la ficha del alta, en PDF (fase 10c). NADA DE URL PÚBLICA (el responsable,
 * 2026-11-19): el PDF no se guarda en ningún bucket ni se firma un enlace; se compone aquí, con la
 * sesión de quien lo pide, y se entrega en la respuesta sin caché. Quién puede, lo decide la base
 * (`leer_ficha_firmada`), que deja la lectura en `lecturas_ficha_medica`. Se compone con la
 * plantilla de la versión que guarda la firma.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; firmaId: string }> }
): Promise<Response> {
  const { firmaId } = await params
  if (!z.string().uuid().safeParse(firmaId).success)
    return new Response('Not found', { status: 404 })

  const lectura = await leerFichaFirmada(await createClient(), firmaId)
  if (!lectura.ok) {
    const status =
      lectura.motivo === 'no_encontrada' ? 404 : lectura.motivo === 'bloqueada' ? 403 : 500
    return new Response(status === 404 ? 'Not found' : 'Unavailable', {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }

  const bytes = await componerFichaFirmada(lectura.copia)
  const dia = lectura.copia.firmadoAt.slice(0, 10)
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ficha-firmada-${dia}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
