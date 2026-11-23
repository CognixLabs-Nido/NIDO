import { createHash } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { generarMandatoPdf } from '@/features/alta/lib/mandato-pdf'
import { PLANTILLA_PDF_MANDATO_VIGENTE } from '@/features/alta/lib/mandato-pdf-plantillas'
import { textoCanonicoMandatoV3 } from '@/features/alta/lib/mandato-sepa'
import type { Database } from '@/types/db'

import { serviceClient } from './setup'

/**
 * Desde `20270204120000` un mandato digital nuevo es v3 (`zz_digital_v3`): lleva el PDF que compone
 * el servidor, atado al sello. Los tests que firmaban un digital v2 a mano (un hash inventado y sin
 * PDF) lo pasan por aquí: con los MISMOS datos de la llamada (actor, IBAN, identificador, titular,
 * fecha), compone el PDF con la función de la app, calcula su sha256 y el sello v3 con la de la app,
 * lo sube con la sesión de quien firma a la ruta del sello y devuelve los argumentos del v3. Un
 * presencial no cambia: sigue siendo v2.
 *
 * Si la subida falla (quien firma no puede escribir en esa familia), no lanza: la llamada a la base
 * contesta lo suyo, que es lo que esos tests miden.
 */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

type Args = Record<string, unknown>

export async function conPdfV3(cliente: SupabaseClient<Database>, args: object): Promise<never> {
  const a = args as Args
  if (a.p_metodo === 'presencial') return args as never
  const familia = String(a.p_familia_id)
  const { data: f } = await serviceClient
    .from('familias')
    .select('centro_id')
    .eq('id', familia)
    .maybeSingle()
  const { data: c } = f
    ? await serviceClient
        .from('centros')
        .select('nombre, identificador_acreedor, direccion')
        .eq('id', f.centro_id)
        .maybeSingle()
    : { data: null }
  const acreedorNombre = String(a.p_acreedor_nombre ?? c?.nombre ?? '')
  const acreedorCid = String(a.p_acreedor_cid ?? c?.identificador_acreedor ?? '')
  const acreedorDireccion = (c?.direccion ?? '').trim()
  const fecha = new Date(String(a.p_fecha_firma ?? new Date().toISOString())).toISOString()
  const firma =
    typeof a.p_firma_imagen === 'string' && a.p_firma_imagen !== '' ? a.p_firma_imagen : PNG
  const identificador = String(a.p_identificador_mandato)
  const comun = {
    identificadorMandato: identificador,
    iban: String(a.p_iban),
    titular: String(a.p_titular),
    titularDocumento: String(a.p_titular_documento ?? ''),
    titularDireccion: String(a.p_titular_direccion ?? ''),
    acreedorNombre,
    acreedorCid,
    acreedorDireccion,
    fechaFirmaIso: fecha,
  }
  const pdf = generarMandatoPdf({
    ...comun,
    firmaDataUrl: firma,
    idioma: 'es',
    plantillaVersion: PLANTILLA_PDF_MANDATO_VIGENTE,
  })
  const documentoSha256 = sha256(pdf)
  const sello = sha256(
    textoCanonicoMandatoV3({
      ...comun,
      documentoSha256,
      idioma: 'es',
      plantillaPdfVersion: PLANTILLA_PDF_MANDATO_VIGENTE,
    })
  )
  const ruta = `${f?.centro_id ?? 'sin-centro'}/familia/${familia}/mandato-${sello}.pdf`
  await cliente.storage
    .from('mandato-sepa')
    .upload(ruta, pdf, { contentType: 'application/pdf', upsert: false })
  return {
    ...a,
    p_metodo: 'digital',
    p_firma_imagen: firma,
    p_fecha_firma: fecha,
    p_texto_hash: sello,
    p_documento_path: ruta,
    p_documento_sha256: documentoSha256,
    p_documento_idioma: 'es',
    p_plantilla_pdf_version: PLANTILLA_PDF_MANDATO_VIGENTE,
    p_acreedor_direccion: acreedorDireccion,
  } as never
}

/**
 * La llamada de siempre (`cliente.rpc(fn, args)`) con los argumentos pasados por `conPdfV3`: un
 * digital entra como v3; un presencial, tal cual.
 */
export async function firmarV3(
  cliente: SupabaseClient<Database>,
  fn: 'registrar_mandato_sepa' | 'sustituir_mandato_sepa' | 'proponer_mandato_sepa',
  args: object
) {
  return cliente.rpc(fn, await conPdfV3(cliente, args))
}
