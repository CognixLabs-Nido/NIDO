import 'server-only'

import { createHash } from 'node:crypto'

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { BUCKET_MANDATO_SEPA } from '@/shared/lib/adjuntos/storage'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/db'

import { normalizarIban } from './iban'
import { generarMandatoPdf } from './mandato-pdf'
import {
  IDIOMAS_MANDATO,
  PLANTILLA_PDF_MANDATO_VIGENTE,
  type IdiomaMandato,
} from './mandato-pdf-plantillas'
import { generarIdentificadorMandato, textoCanonicoMandatoV3 } from './mandato-sepa'
import { motivoRechazoV2, type AcreedorMandato } from './mandato-v2-servidor'
import {
  motivoCola,
  proponerMandatoSepa,
  registrarOSustituirMandatoSepa,
  type MandatoSepaRpcArgs,
} from './registrar-mandato-sepa'

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

export interface FirmaMandatoDigital {
  familiaId: string
  centroId: string
  /** El niño del alta, o null desde Recibos. */
  ninoId: string | null
  /** Quien firma: entra en el identificador del mandato. */
  usuarioId: string
  acreedor: AcreedorMandato & { cid: string }
  iban: string
  titular: string
  titularDocumento: string
  titularDireccion: string
  nombreTecleado: string
  firmaImagen: string
  idioma: IdiomaMandato
  ipAddress: string | null
  userAgent: string | null
  /** `proponer` con el alta validada (la cola); si no, registrar o sustituir según haya activo. */
  via: 'proponer' | 'registrar' | 'sustituir'
}

export interface ResultadoFirmaMandato {
  error: PostgrestError | null
  mandatoId: string | null
  identificador: string
}

/**
 * Un mandato digital v3 (2026-11-22, cierre del mandato: `docs/specs/mandato-sepa-cierre.md`). El
 * servidor genera el identificador, compone el PDF (determinista, con la plantilla vigente), calcula
 * su sha256 y el sello del texto canónico v3, y sube el PDF con el NOMBRE DEL SELLO
 * (`{centro}/familia/{familia}/mandato-{sello}.pdf`), sin `upsert`: una firma nueva es un objeto
 * nuevo (decisión 1). Después registra la fila, y la base recalcula el sello, mira la ruta y que el
 * fichero esté (decisión 7). Storage no es transaccional: si el registro falla, el servidor borra el
 * fichero que acaba de subir y que ninguna fila nombra; si ni eso puede, queda un huérfano que solo
 * cuenta si una fila lo nombra, y el cron de retención lo cuenta y lo borra
 * (`mandatos_sepa_huerfanos`).
 *
 * Todo con la sesión de quien firma salvo ese borrado, que es del servidor.
 */
export async function firmarMandatoDigital(
  supabase: SupabaseClient<Database>,
  f: FirmaMandatoDigital
): Promise<ResultadoFirmaMandato> {
  const identificador = generarIdentificadorMandato(f.centroId, f.usuarioId, Date.now())
  const fechaFirmaIso = new Date().toISOString()
  const iban = normalizarIban(f.iban)
  const titular = f.titular.trim()
  const titularDocumento = f.titularDocumento.trim()
  const titularDireccion = f.titularDireccion.trim()
  const plantilla = PLANTILLA_PDF_MANDATO_VIGENTE

  const pdf = generarMandatoPdf({
    identificadorMandato: identificador,
    iban,
    titular,
    titularDocumento,
    titularDireccion,
    acreedorNombre: f.acreedor.nombre,
    acreedorDireccion: f.acreedor.direccion,
    acreedorCid: f.acreedor.cid,
    firmaDataUrl: f.firmaImagen,
    fechaFirmaIso,
    idioma: f.idioma,
    plantillaVersion: plantilla,
  })
  const documentoSha256 = sha256(pdf)
  const sello = sha256(
    textoCanonicoMandatoV3({
      identificadorMandato: identificador,
      iban,
      titular,
      titularDocumento,
      titularDireccion,
      acreedorNombre: f.acreedor.nombre,
      acreedorCid: f.acreedor.cid,
      acreedorDireccion: f.acreedor.direccion,
      fechaFirmaIso,
      documentoSha256,
      idioma: f.idioma,
      plantillaPdfVersion: plantilla,
    })
  )
  const path = `${f.centroId}/familia/${f.familiaId}/mandato-${sello}.pdf`

  const subida = await supabase.storage
    .from(BUCKET_MANDATO_SEPA)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: false })
  if (subida.error) {
    return {
      error: {
        name: 'PostgrestError',
        message: subida.error.message,
        details: '',
        hint: 'subida',
        code: /row-level security|unauthorized|403/i.test(subida.error.message) ? '42501' : '',
      } as PostgrestError,
      mandatoId: null,
      identificador,
    }
  }

  const args: MandatoSepaRpcArgs = {
    p_familia_id: f.familiaId,
    p_nino_id: f.ninoId,
    p_iban: iban,
    p_titular: titular,
    p_identificador_mandato: identificador,
    p_documento_path: path,
    p_firma_imagen: f.firmaImagen,
    p_nombre_tecleado: f.nombreTecleado.trim(),
    p_texto_hash: sello,
    p_ip_address: f.ipAddress,
    p_user_agent: f.userAgent,
    p_fecha_firma: fechaFirmaIso,
    p_metodo: 'digital',
    p_titular_documento: titularDocumento,
    p_titular_direccion: titularDireccion,
    p_acreedor_cid: f.acreedor.cid,
    p_acreedor_nombre: f.acreedor.nombre,
    p_documento_sha256: documentoSha256,
    p_documento_idioma: f.idioma,
    p_plantilla_pdf_version: plantilla,
    p_acreedor_direccion: f.acreedor.direccion,
  }
  const { data, error } =
    f.via === 'proponer'
      ? await proponerMandatoSepa(supabase, args)
      : await registrarOSustituirMandatoSepa(supabase, f.via === 'sustituir', args)

  if (error) {
    // Ninguna fila lo nombra: no es una prueba. Se borra; si falla, lo recoge el cron.
    const { error: errBorrar } = await createServiceRoleClient()
      .storage.from(BUCKET_MANDATO_SEPA)
      .remove([path])
    if (errBorrar)
      logger.warn('mandato: el fichero sin registro se queda para el cron', errBorrar.message)
    return { error, mandatoId: null, identificador }
  }
  return { error: null, mandatoId: typeof data === 'string' ? data : null, identificador }
}

/** Lo que contesta una firma que no entra, como clave de mensaje y estado HTTP. Lo usan las rutas. */
export function errorDeFirmaMandato(
  error: Pick<PostgrestError, 'message' | 'hint' | 'code'>,
  claves: { noAutorizado: string; otroIban: string; guardado: string; subida: string }
): { clave: string; status: number } {
  if (error.hint === 'subida')
    return error.code === '42501'
      ? { clave: claves.noAutorizado, status: 403 }
      : { clave: claves.subida, status: 500 }
  const cola = motivoCola(error.hint ?? undefined)
  if (cola) return { clave: cola, status: 409 }
  if (/no autorizado|42501/i.test(error.message) || error.code === '42501')
    return { clave: claves.noAutorizado, status: 403 }
  const motivo = motivoRechazoV2(error.hint)
  if (motivo) return { clave: `alta.sepa.errors.${motivo}`, status: 409 }
  if (/mandato_activo_otro_iban/i.test(error.message))
    return { clave: claves.otroIban, status: 409 }
  logger.warn('mandato: la firma no entró', error.hint ?? error.code ?? 'sin_codigo')
  return { clave: claves.guardado, status: 500 }
}

/** El idioma del PDF: el de la página desde la que se firma, si es uno de los tres. */
export function idiomaDelMandato(locale: string): IdiomaMandato {
  return IDIOMAS_MANDATO.includes(locale as IdiomaMandato) ? (locale as IdiomaMandato) : 'es'
}
