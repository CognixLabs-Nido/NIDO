'use server'

import { revalidatePath } from 'next/cache'

import { normalizarIban } from '@/features/alta/lib/iban'
import { generarIdentificadorMandato } from '@/features/alta/lib/mandato-sepa'
import { familiaTieneMandatoActivo } from '@/features/alta/queries/get-mandato-familia'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
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
 * PDF (`documento_path` NULL) ni trazo (`firma_imagen=''`). El respaldo legal es el físico.
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

  const centroId = await getCentroActualId()
  if (!centroId) return fail('listaEspera.errors.sin_centro')

  // Gate admin del centro (defensa en profundidad; la RPC también gatea es_admin).
  const { data: roles } = await supabase
    .from('roles_usuario')
    .select('rol, centro_id')
    .eq('usuario_id', userData.user.id)
    .is('deleted_at', null)
  const isAdmin = roles?.some((r) => r.centro_id === centroId && r.rol === 'admin')
  if (!isAdmin) return fail('auth.invitation.errors.forbidden')

  // La familia debe pertenecer al centro del admin. La RLS `familias_select` (es_admin(centro))
  // solo deja leerla si es de su centro → si no aparece, es de otro centro (o no existe).
  const { data: familia } = await supabase
    .from('familias')
    .select('id, centro_id')
    .eq('id', parsed.data.familia_id)
    .maybeSingle()
  if (!familia || familia.centro_id !== centroId) return fail('admin.familias.errors.no_encontrada')

  const iban = normalizarIban(parsed.data.iban)
  const titular = parsed.data.titular.trim()

  // ¿La familia ya tiene mandato activo? → sustituir; si no → registrar (1º).
  const activo = await familiaTieneMandatoActivo(parsed.data.familia_id)
  const rpc = activo ? 'sustituir_mandato_sepa' : 'registrar_mandato_sepa'

  // Parámetros modo PRESENCIAL: sin PDF (documento_path NULL), sin trazo (firma_imagen ''),
  // metodo='presencial'. p_nino_id NULL (informativo). texto_hash NULL (la RPC no lo exige;
  // el canónico/hash es del flujo digital con IBAN en claro del formulario, aquí no aplica).
  const { error } = await supabase.rpc(rpc, {
    p_familia_id: parsed.data.familia_id,
    p_nino_id: null,
    p_iban: iban,
    p_titular: titular,
    p_identificador_mandato: generarIdentificadorMandato(centroId, userData.user.id, Date.now()),
    p_documento_path: null,
    p_firma_imagen: '',
    p_nombre_tecleado: titular,
    p_texto_hash: null,
    p_ip_address: null,
    p_user_agent: null,
    p_fecha_firma: new Date().toISOString(),
    p_metodo: 'presencial',
  } as never)

  if (error) {
    logger.warn('gestionarDomiciliacionFamilia', error.message)
    if (/no autorizado|42501/i.test(error.message))
      return fail('admin.familias.domiciliacion.errors.no_autorizado')
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
