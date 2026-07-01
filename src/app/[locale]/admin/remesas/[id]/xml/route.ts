import { createClient } from '@/lib/supabase/server'

import { prepararRemesa } from '@/features/remesas/lib/preparar-remesa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Genera y descarga el XML pain.008.001.02 de una remesa BAJO DEMANDA (G1: no se
 * almacena; regenerable). Autoriza vía RLS/RPCs admin-only (get_mandatos_remesa +
 * get_datos_acreedor descifran server-side; el IBAN nunca sale al cliente salvo
 * dentro del fichero). Si faltan mandatos / config del acreedor / importes válidos,
 * devuelve 422 con el motivo para que la UI lo explique (no genera a medias).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; id: string }> }
): Promise<Response> {
  const { id } = await params
  const supabase = await createClient()

  // 1. Remesa (RLS admin) → centro/periodo.
  const { data: remesa } = await supabase
    .from('remesas')
    .select('id, centro_id, anio, mes')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!remesa) return json({ error: 'no_encontrada' }, 404)

  const { data: centro } = await supabase
    .from('centros')
    .select('nombre')
    .eq('id', remesa.centro_id)
    .maybeSingle()

  // 2. Deudores (IBAN descifrado server-side) + config del acreedor.
  const [{ data: mandatos, error: errMand }, { data: acreedores, error: errAcr }] =
    await Promise.all([
      supabase.rpc('get_mandatos_remesa', { p_remesa_id: id }),
      supabase.rpc('get_datos_acreedor', { p_centro_id: remesa.centro_id }),
    ])

  if (errMand || errAcr) {
    // RAISE 'No autorizado' en las RPCs (no admin) → 403.
    return json({ error: 'no_autorizado' }, 403)
  }

  const acreedor = acreedores?.[0] ?? {
    identificador_acreedor: null,
    bic_acreedor: null,
    iban: null,
  }

  const now = new Date()
  const resultado = prepararRemesa(mandatos ?? [], acreedor, {
    messageId: `NIDO-${id.slice(0, 8)}-${now.toISOString().slice(0, 19).replace(/[-:T]/g, '')}`,
    creationDateTime: now.toISOString().slice(0, 19),
    collectionDate: now.toISOString().slice(0, 10),
    creditorName: centro?.nombre ?? '',
    sequenceType: 'RCUR',
  })

  if (!resultado.ok) {
    const body =
      resultado.motivo === 'sin_mandato'
        ? { error: resultado.motivo, ninos: resultado.ninosSinMandato }
        : { error: resultado.motivo }
    return json(body, 422)
  }

  const filename = `remesa-${remesa.anio}-${String(remesa.mes).padStart(2, '0')}-${id.slice(0, 8)}.xml`
  return new Response(resultado.xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  })
}
