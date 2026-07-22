import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

import { isRetryableAuthError, withRetry } from './retry'

// =============================================================================
// globalSetup del proyecto `rls` de vitest — WIPE BRUTO ACOTADO al ARRANCAR.
// -----------------------------------------------------------------------------
// Las suites RLS/A6 corren contra la BD remota compartida (ttroedkdgomfmohgojvg)
// y filtraban datos porque el teardown por-fichero falla en silencio y un
// crash/timeout salta el afterAll entero. Este wipe corre UNA vez ANTES de todos
// los tests del proyecto rls (no teardown → un crash no deja basura para la
// siguiente corrida, y permite inspeccionar el estado tras un fallo).
//
// INVARIANTE DE SEGURIDAD (del que depende TODO): los centros de TEST usan SIEMPRE
// `email_contacto` en el dominio `@nido.test`; los centros REALES (ANAIA) NUNCA.
// Las cuentas de TEST usan email `@nido.test`; las 4 reales son `@gmail.com`.
// Ambos dominios son DISJUNTOS del real → el patrón de borrado no puede
// seleccionar lo real. Además, doble guard explícito: se excluye el id de ANAIA
// y las 4 cuentas de la allowlist. TODO borrado se ANCLA a esos dos sets
// (centro_id IN _test_centros / nino_id IN niños-de-esos-centros / actor IN
// _test_users). NUNCA "borra todo salvo X".
//
// Solo se cablea en el proyecto `rls` (NO en `unit`, que no toca la BD).
// =============================================================================

loadEnv({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

// Guard de seguridad — allowlist EXPLÍCITA (nunca se tocan).
const ANAIA_CENTRO_ID = '33c79b50-13b5-4962-b849-d88dd6a21366'
const ALLOWLIST_EMAILS = new Set([
  'jovimib@gmail.com',
  'jovimib+profe@gmail.com',
  'jovimib+teacher2@gmail.com',
  'jovimib+profe3@gmail.com',
])
const TEST_EMAIL_LIKE = '%@nido.test'

// Buckets a barrer (best-effort), scoped por prefijo {centroId}. centro-assets NO.
const TEST_BUCKETS = [
  'dni-tutores',
  'libro-familia',
  'ninos-fotos',
  'recogida-adjuntos',
  'mandato-sepa',
  'aula-fotos',
  'usuarios-fotos',
]

// Cliente de servicio SIN generic de Database: este wipe recorre decenas de tablas
// por nombre dinámico (infra de test, no código de app) — el tipado por-tabla no
// aporta aquí y complica el helper genérico. Bypassa RLS.
const svc = createClient(SUPABASE_URL ?? '', SUPABASE_SERVICE ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
})

const norm = (e: string | null | undefined): string => (e ?? '').trim().toLowerCase()

function chunk<T>(arr: T[], size = 400): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Lee ids de una tabla filtrando por `col IN parentIds` (chunked). */
async function idsWhereIn(table: string, col: string, parentIds: string[]): Promise<string[]> {
  if (parentIds.length === 0) return []
  const out: string[] = []
  for (const part of chunk(parentIds)) {
    const { data, error } = await svc.from(table).select('id').in(col, part)
    if (error) {
      console.warn(`wipe: leer ${table} por ${col}: ${error.code ?? '-'} ${error.message ?? ''}`)
      continue
    }
    out.push(...(data ?? []).map((r: { id: string }) => r.id))
  }
  return out
}

/** DELETE ... WHERE col IN ids (chunked, best-effort: warn y continúa). */
async function delWhereIn(table: string, col: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  for (const part of chunk(ids)) {
    const { error } = await svc.from(table).delete().in(col, part)
    if (error) {
      console.warn(`wipe: borrar ${table}.${col}: ${error.code ?? '-'} ${error.message ?? ''}`)
    }
  }
}

/** Todas las cuentas de test (email @nido.test, no allowlist), paginando perPage:50. */
async function listTestUserIds(): Promise<string[]> {
  const out: string[] = []
  for (let page = 1; ; page++) {
    // Reintenta solo el blip transitorio (429 / "kid <nil>"); un error real cae al
    // warn+break de abajo sin cambiar la lógica de paginación.
    const { data, error } = await withRetry(
      async () => {
        const res = await svc.auth.admin.listUsers({ page, perPage: 50 })
        if (res.error && isRetryableAuthError(res.error)) throw res.error
        return res
      },
      { shouldRetry: isRetryableAuthError }
    )
    if (error) {
      console.warn(
        `wipe: listUsers page ${page}: ${error.name ?? '-'} status=${error.status ?? '-'}`
      )
      break
    }
    const users = data?.users ?? []
    for (const u of users) {
      const email = norm(u.email)
      if (email.endsWith('@nido.test') && !ALLOWLIST_EMAILS.has(email)) out.push(u.id)
    }
    if (users.length < 50) break
  }
  return out
}

/** Borra recursivamente los objetos bajo `${centroId}/` de un bucket (best-effort). */
async function emptyPrefix(bucket: string, prefix: string): Promise<void> {
  const { data, error } = await svc.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error || !data) return
  const files: string[] = []
  for (const entry of data) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.id == null)
      await emptyPrefix(bucket, path) // carpeta/prefijo
    else files.push(path)
  }
  if (files.length > 0)
    await svc.storage
      .from(bucket)
      .remove(files)
      .catch(() => {})
}

export default async function globalSetup(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE) {
    throw new Error(
      'wipe RLS: faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local'
    )
  }

  // ---------------------------------------------------------------------------
  // 0. Sets acotados. _test_centros excluye ANAIA; _test_users excluye la allowlist.
  // ---------------------------------------------------------------------------
  const { data: centrosData, error: centrosErr } = await svc
    .from('centros')
    .select('id')
    .ilike('email_contacto', TEST_EMAIL_LIKE)
    .neq('id', ANAIA_CENTRO_ID)
  if (centrosErr) throw new Error(`wipe: leer centros de test: ${centrosErr.message}`)
  const centroIds: string[] = (centrosData ?? []).map((r: { id: string }) => r.id)

  const ninoIds = await idsWhereIn('ninos', 'centro_id', centroIds)
  const familiaIds = await idsWhereIn('familias', 'centro_id', centroIds)
  const reciboIds = await idsWhereIn('recibos', 'nino_id', ninoIds)
  const remesaIds = await idsWhereIn('remesas', 'centro_id', centroIds)
  const userIds = await listTestUserIds()

  // ---------------------------------------------------------------------------
  // 1. FACTURACIÓN (RESTRICT-bloquea recibos/ninos/familias).
  // ---------------------------------------------------------------------------
  await delWhereIn('recibos_remesa', 'recibo_id', reciboIds)
  await delWhereIn('recibos_remesa', 'remesa_id', remesaIds)
  await delWhereIn('remesas', 'centro_id', centroIds)
  // devoluciones (autoref plantilla RESTRICT) antes que el resto de recibos.
  for (const part of chunk(ninoIds)) {
    const { error } = await svc
      .from('recibos')
      .delete()
      .not('devuelto_de_recibo_id', 'is', null)
      .in('nino_id', part)
    if (error)
      console.warn(`wipe: recibos(devoluciones): ${error.code ?? '-'} ${error.message ?? ''}`)
  }
  await delWhereIn('recibos', 'nino_id', ninoIds)
  await delWhereIn('cierre_mensual', 'centro_id', centroIds)

  // ---------------------------------------------------------------------------
  // 2. CONTENIDO DE STAFF (autor RESTRICT). Cada uno cascadea sus hijos.
  // ---------------------------------------------------------------------------
  await delWhereIn('anuncios', 'centro_id', centroIds) // cascadea lectura_anuncio
  await delWhereIn('eventos', 'centro_id', centroIds) // cascadea confirmaciones_evento
  await delWhereIn('publicaciones', 'centro_id', centroIds) // cascadea media + media_etiquetas
  await delWhereIn('recordatorios', 'centro_id', centroIds)
  await delWhereIn('citas', 'centro_id', centroIds) // cascadea cita_invitados
  await delWhereIn('campanas_informe', 'centro_id', centroIds)

  // ---------------------------------------------------------------------------
  // 3. AUTORIZACIONES + INFORMES + PLANTILLAS + resto RESTRICT de niño. ORDEN:
  //    admin_medicacion → informes → autorizaciones INSTANCIAS (autoref
  //    plantilla_id RESTRICT; cascadea firmas) → autorizaciones PLANTILLAS →
  //    plantillas_informe → conversaciones → nino-RESTRICT.
  // ---------------------------------------------------------------------------
  await delWhereIn('administraciones_medicacion', 'centro_id', centroIds)
  await delWhereIn('informes_evolucion', 'centro_id', centroIds)
  for (const part of chunk(centroIds)) {
    const { error } = await svc
      .from('autorizaciones')
      .delete()
      .eq('es_plantilla', false)
      .in('centro_id', part) // instancias; cascadea firmas_autorizacion
    if (error)
      console.warn(`wipe: autorizaciones(instancias): ${error.code ?? '-'} ${error.message ?? ''}`)
  }
  for (const part of chunk(centroIds)) {
    const { error } = await svc
      .from('autorizaciones')
      .delete()
      .eq('es_plantilla', true)
      .in('centro_id', part) // plantillas (ya sin instancias que las referencien)
    if (error)
      console.warn(`wipe: autorizaciones(plantillas): ${error.code ?? '-'} ${error.message ?? ''}`)
  }
  await delWhereIn('plantillas_informe', 'centro_id', centroIds)
  await delWhereIn('conversaciones', 'centro_id', centroIds) // cascadea mensajes + lectura_conversacion
  await delWhereIn('asistencias', 'nino_id', ninoIds)
  await delWhereIn('ausencias', 'nino_id', ninoIds)
  await delWhereIn('agendas_diarias', 'nino_id', ninoIds) // cascadea comidas/biberones/suenos/deposiciones
  await delWhereIn('info_medica_emergencia', 'nino_id', ninoIds)
  await delWhereIn('datos_pedagogicos_nino', 'nino_id', ninoIds)
  await delWhereIn('matriculas', 'nino_id', ninoIds)

  // ---------------------------------------------------------------------------
  // 4. LISTA DE ESPERA.
  // ---------------------------------------------------------------------------
  await delWhereIn('lista_espera', 'centro_id', centroIds)

  // ---------------------------------------------------------------------------
  // 5. LOGS por ACTOR de test (append-only por RLS; service_role bypassa). Antes
  //    de borrar auth.users (audit_log.usuario_id es NO ACTION → bloquearía).
  // ---------------------------------------------------------------------------
  await delWhereIn('audit_log', 'usuario_id', userIds)
  await delWhereIn('export_log', 'solicitado_por', userIds)
  await delWhereIn('olvido_solicitudes', 'solicitado_por', userIds)

  // ---------------------------------------------------------------------------
  // 5-bis. Tablas de facturación B1/B2 + altas con FK **NO ACTION** a auth.users
  //    (created_by / firmante_id / resuelto_por / realizada_por) y a centros/ninos.
  //    NO cascadean al borrar el centro/niño → bloquearían tanto el DELETE de
  //    ninos/centros (paso 6) como el deleteUser (paso 8) con un 500 FK-block.
  //    Se limpian ANTES del paso 6, ancladas a centro_id IN centroIds (los datos de
  //    test viven siempre en centros de test). El modelo NO se toca (NO ACTION se
  //    queda en producción); esto es solo limpieza de test.
  // ---------------------------------------------------------------------------
  await delWhereIn('beca_comedor_transferencia', 'centro_id', centroIds)
  await delWhereIn('beca_comedor_desborde', 'centro_id', centroIds)
  await delWhereIn('beca_comedor_tramo', 'centro_id', centroIds)
  await delWhereIn('beca_comedor_elegibilidad', 'centro_id', centroIds)
  await delWhereIn('tarifa_concepto_anio', 'centro_id', centroIds)
  await delWhereIn('acuses_alta', 'centro_id', centroIds)

  // ---------------------------------------------------------------------------
  // 6. NIÑOS → FAMILIAS → estructura → centros. ninos cascadea
  //    vinculos, cambios_pendientes, consentimientos(nino), asignacion_concepto,
  //    becas, metodo_pago_familia, parte_servicio_diario, mandatos_sepa.
  //    (familias cascadea las asignacion_concepto por familia.)
  // ---------------------------------------------------------------------------
  await delWhereIn('ninos', 'id', ninoIds)
  await delWhereIn('familias', 'id', familiaIds) // cascadea familia_tutores
  await delWhereIn('aulas', 'centro_id', centroIds) // cascadea aulas_curso + profes_aulas
  await delWhereIn('cursos_academicos', 'centro_id', centroIds)
  // roles_usuario.centro_id → centros es ON DELETE **RESTRICT** (verificado contra
  // pg_constraint: roles_usuario_centro_id_fkey). Bloquea el DELETE de centros y hay
  // que vaciarlo ANTES, anclado a centro_id IN centroIds. NO basta con que caiga por
  // CASCADE de usuarios al borrar la cuenta (paso 8): eso ocurre DESPUÉS de este
  // DELETE de centros → llega tarde. (Corrige la regresión de #195, que lo quitó
  // apoyándose en la premisa falsa de que no había FK a centros.)
  await delWhereIn('roles_usuario', 'centro_id', centroIds)
  // NOTA: conceptos_cobro y tipos_beca NO se borran aquí. Son CATÁLOGO (config de F-1,
  // lo usa el motor de recibos F-4), NO test data; y su centro_id → centros es ON DELETE
  // **CASCADE** (verificado: conceptos_cobro_centro_id_fkey, tipos_beca_centro_id_fkey)
  // → se van solas al borrar el centro. Su referencia RESTRICT (asignacion_concepto.concepto_id;
  // becas — CASCADE de ninos, ya borrados) no existe a esta altura: asignacion_concepto cascadea
  // de ninos/familias (F-4-2), ya borrados en el paso 6, así que la cascada de centros no se bloquea.
  await delWhereIn('centros', 'id', centroIds)

  // ---------------------------------------------------------------------------
  // 7. INVITACIONES: de centros de test + por email @nido.test (antes de auth.users).
  // ---------------------------------------------------------------------------
  await delWhereIn('invitaciones', 'centro_id', centroIds)
  {
    const { error } = await svc.from('invitaciones').delete().ilike('email', TEST_EMAIL_LIKE)
    if (error)
      console.warn(`wipe: invitaciones(email): ${error.code ?? '-'} ${error.message ?? ''}`)
  }

  // ---------------------------------------------------------------------------
  // 8. CUENTAS de test (Admin API; el índice audit_log.usuario_id de #194 hace
  //    rápida la verificación NO ACTION). Concurrencia baja.
  // ---------------------------------------------------------------------------
  for (const part of chunk(userIds, 3)) {
    await Promise.all(
      part.map((id) =>
        // Reintenta el blip transitorio (429 / "kid <nil>") re-lanzando el error crudo;
        // el warn best-effort se mantiene si agota los reintentos. Lógica del wipe intacta.
        withRetry(
          async () => {
            const { error } = await svc.auth.admin.deleteUser(id)
            if (error) throw error
          },
          { shouldRetry: isRetryableAuthError }
        ).catch((error: { name?: string; status?: number }) => {
          console.warn(`wipe: deleteUser: ${error?.name ?? '-'} status=${error?.status ?? '-'}`)
        })
      )
    )
  }

  // ---------------------------------------------------------------------------
  // 9. STORAGE best-effort (warn, NO abort), scoped por {centroId} de test.
  //    NUNCA {ANAIA}/… (centroIds lo excluye) ni centro-assets.
  // ---------------------------------------------------------------------------
  for (const bucket of TEST_BUCKETS) {
    for (const centroId of centroIds) {
      await emptyPrefix(bucket, centroId).catch(() => {})
    }
  }

  // ---------------------------------------------------------------------------
  // 10. VERIFICACIÓN post-wipe. Los DOS anclas deben quedar a 0: por la cadena
  //     FK RESTRICT, un hijo superviviente mantendría vivo su centro/cuenta →
  //     se detectaría aquí. Residuo = bug del wipe → ABORTA (vitest falla rápido).
  // ---------------------------------------------------------------------------
  const residuo: string[] = []

  const { count: centrosRestantes } = await svc
    .from('centros')
    .select('id', { count: 'exact', head: true })
    .ilike('email_contacto', TEST_EMAIL_LIKE)
    .neq('id', ANAIA_CENTRO_ID)
  if ((centrosRestantes ?? 0) > 0) residuo.push(`centros(test)=${centrosRestantes}`)

  const usuariosRestantes = await listTestUserIds()
  if (usuariosRestantes.length > 0) residuo.push(`auth.users(test)=${usuariosRestantes.length}`)

  const { count: invitacionesRestantes } = await svc
    .from('invitaciones')
    .select('id', { count: 'exact', head: true })
    .ilike('email', TEST_EMAIL_LIKE)
  if ((invitacionesRestantes ?? 0) > 0)
    residuo.push(`invitaciones(@nido.test)=${invitacionesRestantes}`)

  if (residuo.length > 0) {
    throw new Error(
      `wipe RLS incompleto (residuo → probable FK no contemplada): ${residuo.join(', ')}. ` +
        `Revisar el orden del globalSetup antes de correr la suite.`
    )
  }
}
