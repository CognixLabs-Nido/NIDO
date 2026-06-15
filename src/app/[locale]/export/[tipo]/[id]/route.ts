import { getTranslations } from 'next-intl/server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { empaquetarExport } from '@/features/export/lib/empaquetar'
import { recolectarNino, recolectarUsuario } from '@/features/export/lib/recolectar'
import { registrarExport } from '@/features/export/lib/registrar'
import type { DocumentoExport, SujetoExport } from '@/features/export/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Export RGPD de un sujeto concreto (#6). Lo usa la DIRECCIÓN ante una petición de
 * acceso (export de un usuario/niño de su centro) y también un tutor para un hijo.
 * Ruta neutra de rol: la RLS del solicitante decide qué puede leer; si no es
 * accesible → 404. No expone datos de terceros más allá de lo que la RLS ya permite.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; tipo: string; id: string }> }
): Promise<Response> {
  const { locale, tipo, id } = await params
  if (tipo !== 'usuario' && tipo !== 'nino') {
    return new Response('Tipo inválido', { status: 400 })
  }
  const sujetoTipo = tipo as SujetoExport

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('No autenticado', { status: 401 })

  const service = await createServiceClient()

  const rec =
    sujetoTipo === 'nino'
      ? await recolectarNino(supabase, service, id)
      : await recolectarUsuario(supabase, service, id)
  if (!rec) return new Response('Sin datos o no autorizado', { status: 404 })

  const doc: DocumentoExport = {
    _meta: {
      generado_en: new Date().toISOString(),
      derecho: 'acceso (art. 15) + portabilidad (art. 20)',
      formato: 'JSON estructurado + copia HTML legible',
      nota: 'Snapshot del momento. No incluye el registro interno de auditoría; las fotos donde aparecen otros menores se listan sin el archivo (PII de terceros). Los enlaces a archivos caducan a las ~24 h.',
      solicitado_por: user.id,
    },
    ...(sujetoTipo === 'nino' ? { nino: rec.data } : { usuario: rec.data }),
  }

  try {
    await registrarExport(
      service,
      [{ sujeto_tipo: sujetoTipo, sujeto_id: id, centro_id: rec.centroId }],
      user.id
    )
  } catch (e) {
    logger.error('export: registrarExport falló', e instanceof Error ? e.message : String(e))
  }

  const t = await getTranslations({ locale, namespace: 'export' })
  const zip = await empaquetarExport(doc, t)
  const fecha = new Date().toISOString().slice(0, 10)
  return new Response(Buffer.from(zip), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="nido-export-${sujetoTipo}-${fecha}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
