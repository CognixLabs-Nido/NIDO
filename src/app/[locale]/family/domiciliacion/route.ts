import { createClient } from '@/lib/supabase/server'

import { familiaTieneMandatoActivo } from '@/features/alta/queries/get-mandato-familia'
import { ibanValido } from '@/features/alta/lib/iban'
import { acreedorDelCentro, errorDatosTitular } from '@/features/alta/lib/mandato-v2-servidor'
import {
  errorDeFirmaMandato,
  firmarMandatoDigital,
  idiomaDelMandato,
} from '@/features/alta/lib/mandato-v3-servidor'
import { familiaAltaValidada } from '@/features/cambios-pendientes/lib/gate'
import { familiaDelUsuarioEn } from '@/features/centros/contexto/ambito-familiar'
import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FIRMA_CHARS = 500000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RespuestaOk {
  success: true
  /** 2026-11-20: con la familia ya validada, el mandato del tutor espera a Dirección en la cola. */
  pendiente: boolean
  /** El mandato registrado; su PDF se abre por `/{locale}/mandato-sepa/{id}`, nunca por un enlace. */
  mandato: { identificador: string; id: string | null }
}
interface RespuestaError {
  success: false
  error: string
}

function err(error: string, status = 400): Response {
  return Response.json({ success: false, error } satisfies RespuestaError, { status })
}

/**
 * La domiciliación SEPA del tutor desde `/family/recibos`, con firma digital. La familia se resuelve
 * en el servidor desde la sesión en el centro de la página (el `centro_id` del formulario solo elige
 * centro). Desde el 2026-11-22 (cierre del mandato, `docs/specs/mandato-sepa-cierre.md`) el móvil
 * manda los datos y el trazo, y el PDF lo compone el SERVIDOR (`firmarMandatoDigital`): sello v3,
 * fichero con el nombre del sello y sin `upsert`. Con el alta validada va a la cola (`proponer`); si
 * no, `registrar` o `sustituir`, según la familia tenga ya un mandato activo.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ locale: string }> }
): Promise<Response> {
  const { locale } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('alta.errors.no_autorizado', 401)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return err('alta.sepa.errors.guardado')
  }

  const centroId = form.get('centro_id')
  if (typeof centroId !== 'string' || !UUID.test(centroId))
    return err('alta.errors.no_autorizado', 403)
  // Censo C: sin leer la familia no es «no autorizado».
  let familia: Awaited<ReturnType<typeof familiaDelUsuarioEn>>
  try {
    familia = await familiaDelUsuarioEn(centroId)
  } catch (e) {
    if (!esLecturaFallida(e)) throw e
    return err('common.lectura_fallida', 500)
  }
  if (!familia) return err('alta.errors.no_autorizado', 403)

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
    typeof firmaImagen !== 'string' ||
    !firmaImagen.startsWith('data:image/png') ||
    firmaImagen.length > MAX_FIRMA_CHARS
  )
    return err('alta.sepa.errors.firma')

  const acreedor = await acreedorDelCentro(supabase, familia.centroId)
  if (!acreedor) return err('alta.errors.no_autorizado', 403)
  if (!acreedor.cid) return err('alta.sepa.errors.centro_sin_cid', 409)

  // Censo C: sin leer si ya hay un mandato activo no se sabe si es «registrar» o «sustituir». Antes era
  // «no hay» y se registraba otro encima. Se dice antes de subir nada.
  let enCola: Awaited<ReturnType<typeof familiaAltaValidada>>
  let activo: Awaited<ReturnType<typeof familiaTieneMandatoActivo>>
  try {
    ;[enCola, activo] = await Promise.all([
      familiaAltaValidada(supabase, familia.centroId, familia.familiaId),
      familiaTieneMandatoActivo(familia.familiaId),
    ])
  } catch (e) {
    if (!esLecturaFallida(e)) throw e
    return err('common.lectura_fallida', 500)
  }
  const r = await firmarMandatoDigital(supabase, {
    familiaId: familia.familiaId,
    centroId: familia.centroId,
    ninoId: null,
    usuarioId: user.id,
    acreedor: { ...acreedor, cid: acreedor.cid },
    iban: ibanRaw,
    titular,
    titularDocumento: titularDocumento as string,
    titularDireccion: titularDireccion as string,
    nombreTecleado,
    firmaImagen,
    idioma: idiomaDelMandato(locale),
    ipAddress: (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null,
    userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
    via: enCola ? 'proponer' : activo ? 'sustituir' : 'registrar',
  })
  if (r.error) {
    const e = errorDeFirmaMandato(r.error, {
      noAutorizado: 'alta.errors.no_autorizado',
      otroIban: 'alta.sepa.errors.mandato_activo_otro_iban',
      guardado: 'alta.sepa.errors.guardado',
      subida: 'alta.documentos.errors.subida',
    })
    return err(e.clave, e.status)
  }
  return Response.json({
    success: true,
    pendiente: enCola,
    mandato: { identificador: r.identificador, id: r.mandatoId },
  } satisfies RespuestaOk)
}
