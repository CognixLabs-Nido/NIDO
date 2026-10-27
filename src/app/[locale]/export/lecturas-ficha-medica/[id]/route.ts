import { getTranslations } from 'next-intl/server'

import { createClient } from '@/lib/supabase/server'

import { getLecturasFichaMedica } from '@/features/ninos/queries/get-lecturas-ficha-medica'
import { getNinoById } from '@/features/ninos/queries/get-ninos'
import { renderRegistroLecturasHtml } from '@/features/ninos/lib/registro-lecturas-html'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * El registro de quién ha leído la ficha médica de un niño, en un HTML imprimible para la familia
 * (derecho de acceso, art. 15). Lo descarga la familia (el tutor legal, desde la ficha de su hijo) y la
 * Dirección del centro, siempre: también con el niño de baja o con el vínculo del tutor ya cerrado,
 * que es cuando la familia ya no puede entrar y se lo entrega la Dirección.
 *
 * ⚠️ La AUTORIZACIÓN es la de `lecturas_ficha_medica` en la BD (tutor legal con vínculo vivo o
 * Dirección del centro), con la sesión de quien descarga. Quien no puede leerlo recibe 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; id: string }> }
): Promise<Response> {
  const { locale, id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('No autenticado', { status: 401 })

  const registro = await getLecturasFichaMedica(id)
  if (registro.tipo === 'no_autorizado') {
    return new Response('Sin datos o no autorizado', { status: 404 })
  }
  if (registro.tipo === 'error') {
    return new Response('No se ha podido generar el registro', { status: 500 })
  }
  const nino = await getNinoById(id, { incluirArchivado: true })
  if (!nino) return new Response('Sin datos o no autorizado', { status: 404 })

  const t = await getTranslations({ locale, namespace: 'ficha_medica_lecturas' })
  const generadoEn = new Date()
  const html = renderRegistroLecturasHtml(
    {
      nino: [nino.nombre, nino.apellidos].filter(Boolean).join(' '),
      generadoEn,
      lecturas: registro.lecturas,
    },
    t,
    locale
  )
  const fecha = generadoEn.toISOString().slice(0, 10)
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="nido-registro-ficha-medica-${fecha}.html"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
