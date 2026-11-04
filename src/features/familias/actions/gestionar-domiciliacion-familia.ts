'use server'

import { revalidatePath } from 'next/cache'

import { normalizarIban } from '@/features/alta/lib/iban'
import { generarIdentificadorMandato } from '@/features/alta/lib/mandato-sepa'
import {
  acreedorDelCentro,
  mandatoV2,
  motivoRechazoV2,
} from '@/features/alta/lib/mandato-v2-servidor'
import { registrarOSustituirMandatoSepa } from '@/features/alta/lib/registrar-mandato-sepa'
import { familiaTieneMandatoActivo } from '@/features/alta/queries/get-mandato-familia'
import { esAdminEn, esSuperusuario } from '@/features/centros/contexto/roles-del-usuario'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  domiciliacionFamiliaSchema,
  type DomiciliacionFamiliaInput,
} from '../schemas/domiciliacion'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F-2c-3 — Dirección registra o sustituye la domiciliación SEPA de una familia desde su ficha,
 * en modo PRESENCIAL (la familia firmó el mandato en PAPEL): `metodo_firma='presencial'`, SIN
 * PDF (`documento_path` NULL) ni trazo (`firma_imagen=''`). El respaldo legal es el físico. Desde
 * el 0c-2 lleva su hash v2 sobre lo que teclea la directora (CID del centro, documento y dirección
 * del titular): un mandato sin hash no tiene prueba de integridad.
 *
 * Decide la RPC según el estado de la familia (el mandato es de la FAMILIA desde F-2c-1):
 *  - sin mandato activo → `registrar_mandato_sepa` (1er mandato),
 *  - con mandato activo → `sustituir_mandato_sepa` (revoca el viejo, conserva histórico, activa
 *    el nuevo, atómico).
 * Las RPCs son SECURITY DEFINER y gatean `es_admin(centro_de_familia) OR es_tutor_de_familia`;
 * aquí se añade gate admin explícito (defensa en profundidad) y se acota la familia al centro.
 */
export async function gestionarDomiciliacionFamilia(
  input: DomiciliacionFamiliaInput
): Promise<ActionResult<{ familia_id: string; operacion: 'registrado' | 'sustituido' }>> {
  const parsed = domiciliacionFamiliaSchema.safeParse(input)
  if (!parsed.success)
    return fail(
      parsed.error.issues[0]?.message ?? 'admin.familias.domiciliacion.validation.invalid'
    )

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return fail('auth.invitation.errors.unauthenticated')

  // El centro es el DE LA FAMILIA, no el centro activo de la cookie. La RLS `familias_select`
  // (es_admin(centro)) solo deja leerla si es de uno de sus centros → si no aparece, es de otro
  // centro (o no existe).
  const { data: familia } = await supabase
    .from('familias')
    .select('id, centro_id')
    .eq('id', parsed.data.familia_id)
    .maybeSingle()
  if (!familia) return fail('admin.familias.errors.no_encontrada')
  const centroId = familia.centro_id

  // Gate admin de ese centro (defensa en profundidad; la RPC también gatea es_admin).
  if (!(await esAdminEn(supabase, userData.user.id, centroId)))
    return fail('auth.invitation.errors.forbidden')
  // El mandato presencial lo registra la directora, que tiene a la familia delante; el
  // superusuario no (ADR-0061; las RPCs también se lo cierran).
  if (await esSuperusuario(supabase)) return fail('admin.familias.errors.presencial_solo_direccion')

  const iban = normalizarIban(parsed.data.iban)
  const titular = parsed.data.titular.trim()

  // Sin CID del centro no se firma ningún mandato (0c, 2026-11-04). La pantalla ya no lo ofrece;
  // esto es por si llega igual.
  const acreedor = await acreedorDelCentro(supabase, centroId)
  if (!acreedor) return fail('admin.familias.errors.no_encontrada')
  if (!acreedor.cid) return fail('admin.familias.domiciliacion.errors.centro_sin_cid')

  // ¿La familia ya tiene mandato activo? → sustituir; si no → registrar (1º). El helper llama
  // a cada RPC con su nombre literal (params tipados; sin `as never`).
  const activo = await familiaTieneMandatoActivo(parsed.data.familia_id)

  // Parámetros modo PRESENCIAL: sin PDF (documento_path NULL), sin trazo (firma_imagen ''),
  // metodo='presencial'. p_nino_id NULL (informativo). El hash es el del texto canónico v2 sobre
  // lo que teclea la directora (0c-2): hasta aquí era NULL, la única vía sin prueba de integridad.
  const identificador = generarIdentificadorMandato(centroId, userData.user.id, Date.now())
  const fechaFirmaIso = new Date().toISOString()
  const v2 = mandatoV2({
    identificadorMandato: identificador,
    iban,
    titular,
    titularDocumento: parsed.data.titular_documento,
    titularDireccion: parsed.data.titular_direccion,
    acreedor: { nombre: acreedor.nombre, cid: acreedor.cid },
    fechaFirmaIso,
  })
  const { error } = await registrarOSustituirMandatoSepa(supabase, Boolean(activo), {
    p_familia_id: parsed.data.familia_id,
    p_nino_id: null,
    p_iban: iban,
    p_titular: titular,
    p_identificador_mandato: identificador,
    p_documento_path: null,
    p_firma_imagen: '',
    p_nombre_tecleado: titular,
    p_texto_hash: v2.textoHash,
    p_ip_address: null,
    p_user_agent: null,
    p_fecha_firma: fechaFirmaIso,
    p_metodo: 'presencial',
    ...v2.rpc,
  })

  if (error) {
    logger.warn('gestionarDomiciliacionFamilia', error.message)
    if (/no autorizado|42501/i.test(error.message))
      return fail('admin.familias.domiciliacion.errors.no_autorizado')
    const motivo = motivoRechazoV2(error.hint)
    if (motivo) return fail(`admin.familias.domiciliacion.errors.${motivo}`)
    // No debería darse (solo llamamos registrar cuando NO hay activo), pero se propaga legible.
    if (/mandato_activo_otro_iban/i.test(error.message))
      return fail('admin.familias.domiciliacion.errors.mandato_activo_otro_iban')
    if (/iban inválido/i.test(error.message))
      return fail('admin.familias.domiciliacion.validation.iban')
    return fail('admin.familias.domiciliacion.errors.guardado')
  }

  revalidatePath('/[locale]/admin/familias/[id]', 'page')
  return ok({ familia_id: parsed.data.familia_id, operacion: activo ? 'sustituido' : 'registrado' })
}
