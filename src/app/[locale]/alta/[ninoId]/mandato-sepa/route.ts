import { createClient } from '@/lib/supabase/server'

import { esAdminDeCentroDeNino } from '@/features/alta/lib/authz-tutor'
import { esSuperusuario } from '@/features/centros/contexto/roles-del-usuario'
import { ibanValido, normalizarIban } from '@/features/alta/lib/iban'
import { generarIdentificadorMandato } from '@/features/alta/lib/mandato-sepa'
import {
  acreedorDelCentro,
  errorDatosTitular,
  mandatoV2,
} from '@/features/alta/lib/mandato-v2-servidor'
import {
  errorDeFirmaMandato,
  firmarMandatoDigital,
  idiomaDelMandato,
} from '@/features/alta/lib/mandato-v3-servidor'
import { registrarOSustituirMandatoSepa } from '@/features/alta/lib/registrar-mandato-sepa'
import { familiaAltaValidada } from '@/features/cambios-pendientes/lib/gate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FIRMA_CHARS = 500000

interface RespuestaOk {
  success: true
  /** 2026-11-20: con la familia ya validada, el mandato del tutor espera a Dirección en la cola. */
  pendiente: boolean
  /** El mandato registrado; su PDF se abre por `/{locale}/mandato-sepa/{id}`, nunca por un enlace. */
  mandato: { identificador: string; id: string | null; conDocumento: boolean }
}
interface RespuestaError {
  success: false
  error: string
}

function err(error: string, status = 400): Response {
  return Response.json({ success: false, error } satisfies RespuestaError, { status })
}

const CLAVES = {
  noAutorizado: 'alta.errors.no_autorizado',
  otroIban: 'alta.sepa.errors.mandato_activo_otro_iban',
  guardado: 'alta.sepa.errors.guardado',
  subida: 'alta.documentos.errors.subida',
}

/**
 * El mandato SEPA del paso 8 del alta. Desde el 2026-11-22 (cierre del mandato,
 * `docs/specs/mandato-sepa-cierre.md`) el móvil manda los datos y el trazo, y el PDF lo compone el
 * SERVIDOR (`firmarMandatoDigital`): su sha256 entra en el sello v3, el fichero se llama por el sello
 * y se sube sin `upsert`. Antes lo componía el navegador y aquí solo se miraba que fuera un PDF.
 *
 * - **El tutor legal** firma con el dedo. Con el alta de la familia validada, el mandato va a la
 *   cola (`proponer`); si no, `registrar` (con el mismo IBAN crea un mandato nuevo y conserva el
 *   anterior; con otro, `mandato_activo_otro_iban`).
 * - **Dirección, presencial** (re-derivado aquí, nunca del cliente): sin trazo y SIN PDF. La prueba
 *   es el papel; el sello v2 cubre lo que teclea la directora. El superusuario no.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ locale: string; ninoId: string }> }
): Promise<Response> {
  const { locale, ninoId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('alta.errors.no_autorizado', 401)

  const { data: nino } = await supabase
    .from('ninos')
    .select('id, centro_id, familia_id')
    .eq('id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!nino || !nino.familia_id) return err('alta.errors.no_autorizado', 403)

  const esPresencial = await esAdminDeCentroDeNino(supabase, nino.id, user.id)
  if (esPresencial && (await esSuperusuario(supabase))) {
    return err('alta.errors.presencial_solo_direccion', 403)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return err('alta.sepa.errors.guardado')
  }
  const ibanRaw = form.get('iban')
  const titular = form.get('titular')
  const nombreTecleado = form.get('nombre_tecleado')
  const firmaImagen = form.get('firma_imagen')
  const titularDocumento = form.get('titular_documento')
  const titularDireccion = form.get('titular_direccion')

  if (typeof ibanRaw !== 'string' || !ibanValido(ibanRaw)) return err('alta.sepa.errors.iban')
  if (typeof titular !== 'string' || titular.trim().length < 2 || titular.length > 140)
    return err('alta.sepa.errors.titular')
  const errorTitular = errorDatosTitular(titularDocumento, titularDireccion)
  if (errorTitular) return err(`alta.sepa.errors.${errorTitular}`)
  if (
    typeof nombreTecleado !== 'string' ||
    nombreTecleado.trim().length < 2 ||
    nombreTecleado.length > 140
  )
    return err('alta.sepa.errors.nombre')
  if (
    !esPresencial &&
    (typeof firmaImagen !== 'string' ||
      !firmaImagen.startsWith('data:image/png') ||
      firmaImagen.length > MAX_FIRMA_CHARS)
  )
    return err('alta.sepa.errors.firma')

  const acreedor = await acreedorDelCentro(supabase, nino.centro_id)
  if (!acreedor) return err('alta.errors.no_autorizado', 403)
  if (!acreedor.cid) return err('alta.sepa.errors.centro_sin_cid', 409)

  const ipAddress = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null
  const userAgent = request.headers.get('user-agent')?.slice(0, 500) ?? null

  if (esPresencial) {
    const identificador = generarIdentificadorMandato(nino.centro_id, user.id, Date.now())
    const fechaFirmaIso = new Date().toISOString()
    const iban = normalizarIban(ibanRaw)
    const v2 = mandatoV2({
      identificadorMandato: identificador,
      iban,
      titular,
      titularDocumento: titularDocumento as string,
      titularDireccion: titularDireccion as string,
      acreedor: { nombre: acreedor.nombre, cid: acreedor.cid },
      fechaFirmaIso,
    })
    const { data, error } = await registrarOSustituirMandatoSepa(supabase, false, {
      p_familia_id: nino.familia_id,
      p_nino_id: nino.id,
      p_iban: iban,
      p_titular: titular.trim(),
      p_identificador_mandato: identificador,
      p_documento_path: null,
      p_firma_imagen: '',
      p_nombre_tecleado: nombreTecleado.trim(),
      p_texto_hash: v2.textoHash,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
      p_fecha_firma: fechaFirmaIso,
      p_metodo: 'presencial',
      ...v2.rpc,
    })
    if (error) {
      const e = errorDeFirmaMandato(error, CLAVES)
      return err(e.clave, e.status)
    }
    return Response.json({
      success: true,
      pendiente: false,
      mandato: { identificador, id: data ?? null, conDocumento: false },
    } satisfies RespuestaOk)
  }

  const enCola = await familiaAltaValidada(supabase, nino.centro_id, nino.familia_id)
  const r = await firmarMandatoDigital(supabase, {
    familiaId: nino.familia_id,
    centroId: nino.centro_id,
    ninoId: nino.id,
    usuarioId: user.id,
    acreedor: { ...acreedor, cid: acreedor.cid },
    iban: ibanRaw,
    titular,
    titularDocumento: titularDocumento as string,
    titularDireccion: titularDireccion as string,
    nombreTecleado,
    firmaImagen: firmaImagen as string,
    idioma: idiomaDelMandato(locale),
    ipAddress,
    userAgent,
    via: enCola ? 'proponer' : 'registrar',
  })
  if (r.error) {
    const e = errorDeFirmaMandato(r.error, CLAVES)
    return err(e.clave, e.status)
  }
  return Response.json({
    success: true,
    pendiente: enCola,
    mandato: { identificador: r.identificador, id: r.mandatoId, conDocumento: true },
  } satisfies RespuestaOk)
}
