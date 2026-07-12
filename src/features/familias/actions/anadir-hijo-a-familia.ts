'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { enviarPushANotificarUsuarios } from '@/features/push/lib/enviar-push'
import { permisosDefault } from '@/features/vinculos/schemas/vinculo'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Json } from '@/types/database'

import { elegirAdultoConCuenta } from '../lib/adulto-con-cuenta'
import { anadirHijoAFamiliaSchema, type AnadirHijoAFamiliaInput } from '../schemas/anadir-hijo'
import { fail, ok, type ActionResult } from '../../centros/types'

/** Retorno JSON de la RPC `crear_o_anadir_a_familia` (F-2b-1 / F-2b-4-1). */
type ResultadoCrearFamilia = {
  resultado: 'familia_creada' | 'nino_anadido' | 'colision'
  familia_id: string | null
  nino_id: string | null
  matricula_id?: string | null
  colision_info: { motivo: string; nombre_existente: string | null } | null
}

/**
 * F-2b-4-2 — Dirección añade un 2º hijo a una familia EXISTENTE. Flujo propio (NO pasa por
 * `crearTutorDirecto` ni por `lista_espera`): la cuenta del tutor YA existe. Se resuelve el
 * adulto con cuenta de la familia (titular preferido) y se enruta a `crear_o_anadir_a_familia`
 * con su `usuario_id` real → 'nino_anadido' (la reactivación de una familia archivada es
 * transparente, F-2b-4-1). La RPC crea el vínculo + rol del hijo nuevo (paso 9); aquí NO se
 * crea vínculo aparte. Tras el éxito, push transitorio best-effort al tutor.
 *
 * `p_tutor_nombre_completo` se pasa EXACTO como está en `familia_tutores` → el chequeo de
 * colisión por nombre de la RPC es inerte. Si aun así devuelve 'colision', es inconsistencia
 * de datos (no un caso esperado) → se propaga como fail, no se silencia.
 */
export async function anadirHijoAFamilia(
  input: AnadirHijoAFamiliaInput,
  locale: string = 'es'
): Promise<ActionResult<{ ninoId: string }>> {
  const parsed = anadirHijoAFamiliaSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'admin.admisiones.anadirHijo.validation.invalid')

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return fail('auth.invitation.errors.unauthenticated')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('listaEspera.errors.sin_centro')

  // Gate admin del centro (los reads sensibles van por service role → gate explícito).
  const { data: roles } = await supabase
    .from('roles_usuario')
    .select('rol, centro_id')
    .eq('usuario_id', userData.user.id)
    .is('deleted_at', null)
  const isAdmin = roles?.some((r) => r.centro_id === centroId && r.rol === 'admin')
  if (!isAdmin) return fail('auth.invitation.errors.forbidden')

  const service = createServiceRoleClient()

  // La familia debe pertenecer al centro del admin.
  const { data: familia } = await service
    .from('familias')
    .select('id, centro_id')
    .eq('id', parsed.data.familia_id)
    .maybeSingle()
  if (!familia || familia.centro_id !== centroId)
    return fail('admin.admisiones.anadirHijo.errors.familia_no_encontrada')

  // Adulto CON CUENTA de la familia (titular preferido). Sin ninguno → familia no elegible.
  const { data: tutores } = await service
    .from('familia_tutores')
    .select('usuario_id, nombre_completo, email, rol_familia')
    .eq('familia_id', parsed.data.familia_id)
    .is('deleted_at', null)
  const adulto = elegirAdultoConCuenta(tutores ?? [])
  if (!adulto) return fail('admin.admisiones.anadirHijo.errors.familia_no_elegible')

  // Parentesco del hijo NUEVO: el que el titular ya use en sus otros vínculos (cualquiera,
  // incluidos los soft-borrados de una familia archivada); por defecto 'otro' (el ENUM
  // `parentesco` no tiene 'tutor_legal'). Es solo el parentesco del vínculo, no identidad.
  const { data: vinculoPrevio } = await service
    .from('vinculos_familiares')
    .select('parentesco, descripcion_parentesco')
    .eq('usuario_id', adulto.usuarioId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const parentesco = vinculoPrevio?.parentesco ?? 'otro'
  const descripcionParentesco = vinculoPrevio?.descripcion_parentesco ?? ''

  // RPC (cliente AUTENTICADO → gate es_admin(auth.uid(), p_centro_id) autoriza dentro).
  const { data: rpcData, error: rpcError } = await supabase.rpc('crear_o_anadir_a_familia', {
    p_nombre_nino: parsed.data.nombre,
    p_apellidos_nino: parsed.data.apellidos,
    p_fecha_nacimiento: parsed.data.fecha_nacimiento,
    p_centro_id: centroId,
    p_aula_id: parsed.data.aula_id,
    // Email INERTE en la rama "añadir a existente" (detección por usuario_id); por limpieza
    // se pasa el del adulto elegido.
    p_tutor_email: adulto.email ?? '',
    // EXACTO el guardado → neutraliza el chequeo de colisión por nombre de la RPC.
    p_tutor_nombre_completo: adulto.nombreCompleto ?? '',
    p_parentesco: parentesco,
    p_descripcion_parentesco: descripcionParentesco,
    p_usuario_id: adulto.usuarioId,
    p_permisos: permisosDefault('tutor_legal_principal') as Json,
  })
  if (rpcError) {
    logger.warn('anadirHijoAFamilia rpc', rpcError.message)
    if (rpcError.code === '42501') return fail('admin.admisiones.anadirHijo.errors.no_autorizado')
    return fail('admin.admisiones.anadirHijo.errors.fallo')
  }

  const res = rpcData as ResultadoCrearFamilia
  if (res.resultado === 'colision') {
    // No esperado (pasamos el nombre exacto) → inconsistencia de datos; se propaga.
    logger.warn('anadirHijoAFamilia colision inesperada', res.colision_info?.nombre_existente ?? '')
    return fail('admin.admisiones.anadirHijo.errors.colision')
  }
  const ninoId = res.nino_id as string

  // PUSH transitorio best-effort al tutor: "se ha añadido a [hijo] a tu familia". Si falla,
  // el alta YA está hecha → no revierte, no falla la action.
  try {
    const { data: perfil } = await service
      .from('usuarios')
      .select('idioma_preferido')
      .eq('id', adulto.usuarioId)
      .maybeSingle()
    const idioma = perfil?.idioma_preferido ?? locale
    const tPush = await getTranslations({
      locale: idioma,
      namespace: 'admin.admisiones.anadirHijo',
    })
    await enviarPushANotificarUsuarios([adulto.usuarioId], {
      titulo: tPush('push_titulo'),
      cuerpo: tPush('push_cuerpo', { nombre: parsed.data.nombre }),
      url: `/${idioma}/family/nino/${ninoId}`,
      datos: { tipo: 'alta_hijo', nino_id: ninoId },
    })
  } catch (err) {
    logger.warn('anadirHijoAFamilia push', err instanceof Error ? err.message : String(err))
  }

  revalidatePath('/[locale]/admin/admisiones', 'page')
  revalidatePath('/[locale]/admin/ninos', 'page')
  return ok({ ninoId })
}
