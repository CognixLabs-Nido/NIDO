import { createClient } from '@/lib/supabase/server'

import { conceptosDeRemesa } from '@/features/remesas/lib/concepto-adeudo'
import { messageIdRemesa } from '@/features/remesas/lib/message-id'
import { prepararRemesa } from '@/features/remesas/lib/preparar-remesa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Genera y descarga el XML pain.008.001.02 de una remesa BAJO DEMANDA (G1: no se
 * almacena; regenerable). Autoriza vía RLS/RPCs admin-only (get_mandatos_remesa +
 * get_datos_acreedor descifran server-side; el IBAN nunca sale al cliente salvo
 * dentro del fichero). Si faltan mandatos / config del acreedor / importes válidos,
 * devuelve 422 con el motivo para que la UI lo explique (no genera a medias).
 *
 * La primera vez que sale el fichero de una remesa en borrador se marca
 * `fichero_generado_at`, y desde entonces la BD no deja que entre ni salga ningún recibo
 * (`20261120120000`). La marca va ANTES de leer los recibos que van en el fichero: un recibo
 * añadido entre la lectura y la marca quedaría en la remesa sin estar en el fichero. Antes se
 * comprueba que el fichero sale, para no cerrar una remesa con un 422.
 *
 * El MsgId sale de esa marca, no de la hora de la descarga (`message-id.ts`): dos descargas de la
 * misma versión son el mismo fichero para el banco, que rechaza el segundo en vez de cobrarlo dos
 * veces. Por eso también se marca la remesa enviada que no la tiene (las de antes de la marca): su
 * primera descarga fija el MsgId de las siguientes. La marca se vuelve a leer después de ponerla:
 * si otra descarga la puso a la vez, el UPDATE no toca nada y vale la suya.
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
    // `*`: lee fichero_generado_at sin romper si el despliegue llega antes que su migración.
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!remesa) return json({ error: 'no_encontrada' }, 404)

  const { data: centro } = await supabase
    .from('centros')
    .select('nombre')
    .eq('id', remesa.centro_id)
    .maybeSingle()

  // 2. Deudores (IBAN descifrado server-side) + config del acreedor → el fichero, o el motivo.
  // `marca` NULL solo en la comprobación previa, o si la columna no existe (PGRST204, abajo).
  async function generar(marca: string | null): Promise<{ xml: string } | Response> {
    const [{ data: mandatos, error: errMand }, { data: acreedores, error: errAcr }] =
      await Promise.all([
        supabase.rpc('get_mandatos_remesa', { p_remesa_id: id }),
        supabase.rpc('get_datos_acreedor', { p_centro_id: remesa!.centro_id }),
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

    // El concepto de cada adeudo: el mes del recibo y los niños de sus líneas (el recibo es de la
    // familia). Un fallo de lectura no saca el fichero sin nombres: 500.
    const reciboIds = (mandatos ?? []).map((m) => m.recibo_id)
    let conceptos = new Map<string, string>()
    if (reciboIds.length > 0) {
      const [{ data: recibos, error: errRec }, { data: lineas, error: errLin }] = await Promise.all(
        [
          supabase
            .from('recibos')
            .select('id, anio, mes')
            .eq('centro_id', remesa!.centro_id)
            .in('id', reciboIds),
          supabase
            .from('lineas_recibo')
            .select('recibo_id, nino_id')
            .eq('centro_id', remesa!.centro_id)
            .in('recibo_id', reciboIds),
        ]
      )
      if (errRec || errLin) return json({ error: 'xml_failed' }, 500)
      const ninoIds = [
        ...new Set((lineas ?? []).map((l) => l.nino_id).filter((n): n is string => !!n)),
      ]
      let ninos: { id: string; nombre: string; apellidos: string | null }[] = []
      if (ninoIds.length > 0) {
        // Sin filtrar `deleted_at`: el niño de baja también se cobra, y su nombre va en el concepto.
        const { data, error: errNin } = await supabase
          .from('ninos')
          .select('id, nombre, apellidos')
          .eq('centro_id', remesa!.centro_id)
          .in('id', ninoIds)
        if (errNin) return json({ error: 'xml_failed' }, 500)
        ninos = data ?? []
      }
      conceptos = conceptosDeRemesa(centro?.nombre ?? '', recibos ?? [], lineas ?? [], ninos)
    }

    const now = new Date()
    const resultado = prepararRemesa(
      mandatos ?? [],
      acreedor,
      {
        messageId: messageIdRemesa(id, marca ?? now.toISOString()),
        creationDateTime: now.toISOString().slice(0, 19),
        collectionDate: now.toISOString().slice(0, 10),
        creditorName: centro?.nombre ?? '',
        sequenceType: 'RCUR',
      },
      conceptos
    )

    if (!resultado.ok) {
      const body =
        resultado.motivo === 'sin_mandato'
          ? { error: resultado.motivo, familias: resultado.familiasSinMandato }
          : resultado.motivo === 'identificador_largo'
            ? { error: resultado.motivo, familias: resultado.familiasIdentificadorLargo }
            : { error: resultado.motivo }
      return json(body, 422)
    }
    return { xml: resultado.xml }
  }

  const marcaLeida: string | null = remesa.fichero_generado_at ?? null
  let fichero = await generar(marcaLeida)
  if (fichero instanceof Response) return fichero

  // 3. Sin marca: se pone, se vuelve a leer, y el fichero sale otra vez con su MsgId y, en
  //    borrador, ya con la remesa cerrada.
  if (!marcaLeida) {
    const { error: errMarca } = await supabase
      .from('remesas')
      .update({ fichero_generado_at: new Date().toISOString() })
      .eq('id', id)
      .is('fichero_generado_at', null)
    // PGRST204: la columna aún no existe (desplegado antes que la migración). Sin columna no hay
    // trigger que cierre la remesa ni marca de la que sacar el MsgId: el fichero ya leído vale,
    // como antes.
    if (errMarca && errMarca.code !== 'PGRST204') return json({ error: 'xml_failed' }, 500)
    if (!errMarca) {
      // La ausencia aquí no es legítima: acabamos de marcarla o la marcó otro. Sin marca no hay
      // MsgId estable, y servir uno con la hora sería el doble cobro que esto evita.
      const { data: marcada, error: errLeer } = await supabase
        .from('remesas')
        .select('fichero_generado_at')
        .eq('id', id)
        .maybeSingle()
      const marca = marcada?.fichero_generado_at ?? null
      if (errLeer || !marca) return json({ error: 'xml_failed' }, 500)
      fichero = await generar(marca)
      if (fichero instanceof Response) return fichero
    }
  }

  const filename = `remesa-${remesa.anio}-${String(remesa.mes).padStart(2, '0')}-${id.slice(0, 8)}.xml`
  return new Response(fichero.xml, {
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
