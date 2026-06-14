import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { empaquetarExport } from '@/features/export/lib/empaquetar'
import { recolectarNino, recolectarUsuario } from '@/features/export/lib/recolectar'
import { registrarExport, type SujetoRegistrado } from '@/features/export/lib/registrar'
import type { DocumentoExport } from '@/features/export/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Export RGPD — auto-servicio de la familia (#6). Descarga un ZIP con SUS datos y
 * los de su(s) hijo(s). Todo se recolecta con el cliente del usuario → la RLS
 * garantiza que solo sale lo suyo. Acceso art. 15 + portabilidad art. 20.
 */
export async function GET(): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('No autenticado', { status: 401 })

  const service = await createServiceClient()

  const usuarioRec = await recolectarUsuario(supabase, service, user.id)
  if (!usuarioRec) return new Response('Sin datos', { status: 404 })

  // Hijos de los que es tutor legal (no 'autorizado').
  const { data: vinc } = await supabase
    .from('vinculos_familiares')
    .select('nino_id, tipo_vinculo')
    .eq('usuario_id', user.id)
    .is('deleted_at', null)
  const ninoIds = [
    ...new Set((vinc ?? []).filter((v) => v.tipo_vinculo !== 'autorizado').map((v) => v.nino_id)),
  ]

  const sujetos: SujetoRegistrado[] = [
    { sujeto_tipo: 'usuario', sujeto_id: user.id, centro_id: usuarioRec.centroId },
  ]
  const hijos: Array<Record<string, unknown>> = []
  for (const ninoId of ninoIds) {
    const rec = await recolectarNino(supabase, service, ninoId)
    if (!rec) continue
    hijos.push(rec.data)
    sujetos.push({ sujeto_tipo: 'nino', sujeto_id: ninoId, centro_id: rec.centroId })
  }

  const doc: DocumentoExport = {
    _meta: {
      generado_en: new Date().toISOString(),
      derecho: 'acceso (art. 15) + portabilidad (art. 20)',
      formato: 'JSON estructurado + copia HTML legible',
      nota: 'Snapshot del momento. No incluye el registro interno de auditoría; las fotos donde aparecen otros menores se listan sin el archivo (PII de terceros). Los enlaces a archivos caducan a las ~24 h.',
      solicitado_por: user.id,
    },
    usuario: usuarioRec.data,
    hijos,
  }

  try {
    await registrarExport(service, sujetos, user.id)
  } catch (e) {
    logger.error('export: registrarExport falló', e instanceof Error ? e.message : String(e))
  }

  const zip = await empaquetarExport(doc)
  const fecha = new Date().toISOString().slice(0, 10)
  return new Response(Buffer.from(zip), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="nido-mis-datos-${fecha}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
