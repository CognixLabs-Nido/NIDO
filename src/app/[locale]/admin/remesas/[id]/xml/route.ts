import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { BUCKET_REMESAS_FICHEROS } from '@/shared/lib/adjuntos/storage'
import { logger } from '@/shared/lib/logger'

import { conceptosDeRemesa } from '@/features/remesas/lib/concepto-adeudo'
import {
  obtenerFicheroRemesa,
  type FalloFichero,
  type FicheroGenerado,
} from '@/features/remesas/lib/fichero-remesa'
import { versionRemesa } from '@/features/remesas/lib/message-id'
import { prepararRemesa } from '@/features/remesas/lib/preparar-remesa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * El XML pain.008.001.02 de una remesa. Desde R-1 (`20261220120000`; sustituye a G1, «no se
 * almacena; regenerable», decisión P-1 del 2026-11-01) se guarda la primera vez que sale, y cada
 * descarga de esa versión entrega el guardado, byte a byte (`obtenerFicheroRemesa`). Generado otra
 * vez podía llevar otro IBAN: `get_mandatos_remesa` toma el mandato activo en cada descarga.
 *
 * Autoriza la sesión de Dirección: la remesa por su RLS, y las RPCs (`get_mandatos_remesa`,
 * `get_datos_acreedor`, que descifran en el servidor; `fichero_remesa_vigente` y
 * `registrar_fichero_remesa`) son `es_admin`. El bucket privado lo lee y lo escribe el cliente de
 * servicio, después de esa autorización. Si faltan mandatos, datos del acreedor o importes, 422
 * con el motivo (no genera a medias).
 *
 * La primera descarga pone la marca (`fichero_generado_at`) y el registro en una transacción
 * (`registrar_fichero_remesa`), y desde entonces la BD no deja que entre ni salga ningún recibo
 * (`20261120120000`). Esa función comprueba que los recibos de la remesa son los del fichero: si
 * entró o salió alguno entre la lectura y la marca, no registra nada (409). Antes se comprueba que
 * el fichero sale, para no cerrar una remesa con un 422.
 *
 * Todo lo que no sale de los recibos sale de la marca (`versionRemesa`): el MsgId, `CreDtTm` y la
 * fecha de cobro de los recibos que no tienen la suya. Un bloque de pago por fecha.
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
    .select('id, centro_id, anio, mes, fichero_generado_at')
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
  // `marca` NULL solo en la comprobación previa: ahí la hora no importa.
  async function generar(marca: string | null): Promise<FicheroGenerado | FalloFichero> {
    const [{ data: mandatos, error: errMand }, { data: acreedores, error: errAcr }] =
      await Promise.all([
        supabase.rpc('get_mandatos_remesa', { p_remesa_id: id }),
        supabase.rpc('get_datos_acreedor', { p_centro_id: remesa!.centro_id }),
      ])

    if (errMand || errAcr) {
      // RAISE 'No autorizado' en las RPCs (no admin) → 403.
      return { status: 403, body: { error: 'no_autorizado' } }
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
    let fechasCobro = new Map<string, string | null>()
    if (reciboIds.length > 0) {
      const [{ data: recibos, error: errRec }, { data: lineas, error: errLin }] = await Promise.all(
        [
          supabase
            .from('recibos')
            .select('id, anio, mes, fecha_cobro_banco')
            .eq('centro_id', remesa!.centro_id)
            .in('id', reciboIds),
          supabase
            .from('lineas_recibo')
            .select('recibo_id, nino_id')
            .eq('centro_id', remesa!.centro_id)
            .in('recibo_id', reciboIds),
        ]
      )
      if (errRec || errLin) return { status: 500, body: { error: 'xml_failed' } }
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
        if (errNin) return { status: 500, body: { error: 'xml_failed' } }
        ninos = data ?? []
      }
      conceptos = conceptosDeRemesa(centro?.nombre ?? '', recibos ?? [], lineas ?? [], ninos)
      fechasCobro = new Map((recibos ?? []).map((r) => [r.id, r.fecha_cobro_banco]))
    }

    // Sin marca vale la hora de ahora: es la comprobación previa, solo para saber si el fichero sale.
    const version = versionRemesa(id, marca ?? new Date().toISOString())
    const resultado = prepararRemesa(
      mandatos ?? [],
      acreedor,
      {
        messageId: version.messageId,
        creationDateTime: version.creationDateTime,
        fechaPorDefecto: version.fechaPorDefecto,
        creditorName: centro?.nombre ?? '',
        sequenceType: 'RCUR',
      },
      conceptos,
      fechasCobro
    )

    if (!resultado.ok) {
      const body =
        resultado.motivo === 'sin_mandato'
          ? { error: resultado.motivo, familias: resultado.familiasSinMandato }
          : resultado.motivo === 'identificador_largo'
            ? { error: resultado.motivo, familias: resultado.familiasIdentificadorLargo }
            : { error: resultado.motivo }
      return { status: 422, body }
    }
    return { xml: resultado.xml, msgId: version.messageId, adeudos: resultado.adeudos }
  }

  // 3. El fichero de la versión: el guardado o, la primera vez, el que se genera, guarda y registra.
  const servicio = createServiceRoleClient()
  const bucket = () => servicio.storage.from(BUCKET_REMESAS_FICHEROS)
  const fichero = await obtenerFicheroRemesa(
    {
      vigente: async () => {
        const { data, error } = await supabase.rpc('fichero_remesa_vigente', { p_remesa_id: id })
        if (error) return 'error'
        const v = data?.[0]
        return v ? { ruta: v.ruta, sha256: v.sha256 } : null
      },
      generar,
      subir: async (ruta, xml) => {
        const { error } = await bucket().upload(ruta, xml, {
          contentType: 'application/xml',
          upsert: false,
        })
        if (!error) return 'ok'
        return esYaExiste(error) ? 'existe' : 'error'
      },
      bajar: async (ruta) => {
        const { data, error } = await bucket().download(ruta)
        return error || !data ? null : data.text()
      },
      borrar: async (ruta) => {
        const { error } = await bucket().remove([ruta])
        // Lo recoge el barrido de huérfanos (`ficheros_remesa_huerfanos`).
        if (error) logger.error('remesa: no se pudo borrar un fichero sin registro', error.message)
      },
      registrar: async (v) => {
        const { error } = await supabase.rpc('registrar_fichero_remesa', {
          p_remesa_id: id,
          p_marca: v.marca,
          p_msg_id: v.msgId,
          p_sha256: v.sha256,
          p_ruta: v.ruta,
          p_adeudos: v.adeudos,
        })
        return error ? { ok: false, hint: error.hint ?? null } : { ok: true }
      },
      ahora: () => new Date(),
    },
    { id, centroId: remesa.centro_id, marca: remesa.fichero_generado_at ?? null }
  )
  if ('status' in fichero) return json(fichero.body, fichero.status)

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

/** El objeto ya existe en la ruta: Storage contesta 409 («Duplicate» / «already exists»). */
function esYaExiste(error: { message?: string; statusCode?: string; status?: number }): boolean {
  return (
    error.status === 409 ||
    error.statusCode === '409' ||
    /already exists|duplicate/i.test(error.message ?? '')
  )
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  })
}
