import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

import type { Database } from '@/types/database'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_ANON || !SUPABASE_SERVICE) {
  throw new Error(
    'Tests RLS requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY en .env.local'
  )
}

export const serviceClient: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

export function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL!, SUPABASE_ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export interface TestUser {
  id: string
  email: string
  password: string
}

export async function createTestUser(opts?: { nombre?: string }): Promise<TestUser> {
  const email = `rls-${randomUUID()}@nido.test`
  const password = 'Rls-Test-Pass-2026!'
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nombre_completo: opts?.nombre ?? 'Test Pruebas' },
  })
  if (error || !data.user) {
    throw new Error(`createTestUser falló: ${error?.message}`)
  }
  return { id: data.user.id, email, password }
}

/**
 * Detecta si un error de Supabase Auth es por rate-limit. Distinguimos entre
 * "demasiados intentos contra el endpoint cloud" (reintentamos) y cualquier
 * otro error real (no reintentamos para no enmascarar bugs).
 */
export function isRateLimitError(err: unknown): boolean {
  if (!err) return false
  const message =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : ''
  const status = (err as { status?: number }).status
  const code = (err as { code?: string }).code
  if (status === 429) return true
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return true
  return /rate.?limit/i.test(message)
}

export interface RetryOptions {
  attempts?: number
  baseDelayMs?: number
  shouldRetry?: (err: unknown) => boolean
  /** Hook de sleep inyectable para tests del propio helper. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Ejecuta `fn`. Si lanza un error para el cual `shouldRetry(err) === true`,
 * reintenta hasta `attempts` veces con backoff exponencial (1s, 2s, 4s con
 * `baseDelayMs=1000`). Si el error no es retryable, falla inmediatamente
 * sin reintentar — fundamental para no enmascarar bugs reales.
 *
 * Vive solo en código de tests. Si se necesita reintento en producción, se
 * implementa de nuevo en el módulo concreto.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5
  const baseDelayMs = opts.baseDelayMs ?? 2000
  const shouldRetry = opts.shouldRetry ?? isRateLimitError
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!shouldRetry(err)) throw err
      if (attempt === attempts - 1) break
      await sleep(baseDelayMs * Math.pow(2, attempt))
    }
  }
  throw lastError
}

export async function clientFor(user: TestUser): Promise<SupabaseClient<Database>> {
  return withRetry(async () => {
    const c = anonClient()
    const { error } = await c.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    })
    if (error) {
      const wrapped = new Error(`signIn falló: ${error.message}`) as Error & {
        status?: number
        code?: string
      }
      wrapped.status = error.status
      wrapped.code = error.code
      throw wrapped
    }
    return c
  })
}

/**
 * Formatea un error de Supabase (GoTrue Auth o PostgREST) para el log de teardown.
 * GoTrue trae `status` + `name` con `message` VACÍO; PostgREST trae `code` + `message` +
 * `details`. Se emiten todos los campos útiles para que el leak sea diagnosticable en CI.
 */
function formatSupabaseError(e: unknown): string {
  const o = (e ?? {}) as {
    status?: number
    name?: string
    code?: string
    message?: string
    details?: string
  }
  return `status=${o.status ?? '-'} name=${o.name ?? '-'} code=${o.code ?? '-'} message=${o.message || '-'} details=${o.details ?? '-'}`
}

export async function deleteTestUser(userId: string): Promise<void> {
  // Best-effort a nivel de fichero: NO lanza (un teardown fallido no debe tumbar la
  // suite), pero YA NO traga el error — lo loggea ruidoso para que el leak sea visible
  // en CI. `error.message` viene vacío en GoTrue → se reporta status + name.
  const { error } = await serviceClient.auth.admin.deleteUser(userId)
  if (error) {
    console.error(`deleteTestUser(${userId}) falló: ${formatSupabaseError(error)}`)
  }
}

export function fakeCentroId(): string {
  return randomUUID()
}

// ---------------------------------------------------------------------------
// Helpers Fase 2: crear entidades de test contra el proyecto remoto y
// limpiarlas en orden inverso al final del test. Las queries usan
// `serviceClient` para bypass RLS (creación) y luego `clientFor(user)` para
// validar las políticas desde el rol auth correspondiente.
// ---------------------------------------------------------------------------

export interface TestCentro {
  id: string
  nombre: string
}

/**
 * INVARIANTE DE SEGURIDAD (del que depende el wipe de PR-C): los centros de TEST usan
 * SIEMPRE `email_contacto` en el dominio `@nido.test`; los centros REALES (p. ej. ANAIA)
 * NUNCA. El wipe de `globalSetup` identifica lo borrable por ese patrón
 * (`email_contacto LIKE '%@nido.test'`, más un guard por id de ANAIA). Si un centro real
 * usara `@nido.test`, el wipe podría alcanzarlo → NO romper esta convención.
 */
export async function createTestCentro(nombre?: string): Promise<TestCentro> {
  const id = randomUUID()
  const finalNombre = nombre ?? `Centro Test ${id.slice(0, 8)}`
  const { error } = await serviceClient.from('centros').insert({
    id,
    nombre: finalNombre,
    direccion: 'Calle Falsa 123',
    telefono: '+34 000 000 000',
    email_contacto: `${id.slice(0, 8)}@nido.test`,
    idioma_default: 'es',
  })
  if (error) throw new Error(`createTestCentro falló: ${error.message}`)
  return { id, nombre: finalNombre }
}

export async function deleteTestCentro(id: string): Promise<void> {
  // FK-safe: borra los dependientes del centro EN ORDEN antes del DELETE de centros
  // (RESTRICT en roles_usuario, matriculas, ninos y otras bloquea el borrado directo).
  // Best-effort a nivel de fichero, pero YA NO muere mudo: inspecciona el error final.
  const svc = serviceClient

  // Niños del centro: los dependientes con FK RESTRICT sobre ninos hay que borrarlos
  // ANTES que los propios niños. El resto (vinculos, autorizaciones-instancia, firmas,
  // datos_tutor, facturación, citas, eventos, recordatorios…) cae por CASCADE al borrar ninos.
  const { data: ninos } = await svc.from('ninos').select('id').eq('centro_id', id)
  const ninoIds = (ninos ?? []).map((n) => n.id)
  if (ninoIds.length > 0) {
    await svc.from('administraciones_medicacion').delete().in('nino_id', ninoIds)
    await svc.from('informes_evolucion').delete().in('nino_id', ninoIds)
    await svc.from('conversaciones').delete().in('nino_id', ninoIds)
    await svc.from('asistencias').delete().in('nino_id', ninoIds)
    await svc.from('ausencias').delete().in('nino_id', ninoIds)
    await svc.from('agendas_diarias').delete().in('nino_id', ninoIds)
    await svc.from('info_medica_emergencia').delete().in('nino_id', ninoIds)
    await svc.from('datos_pedagogicos_nino').delete().in('nino_id', ninoIds)
    await svc.from('matriculas').delete().in('nino_id', ninoIds)
    await svc.from('ninos').delete().in('id', ninoIds)
  }

  // Estructura del centro: aulas cascadea aulas_curso + profes_aulas; familias cascadea
  // familia_tutores.
  await svc.from('aulas').delete().eq('centro_id', id)
  await svc.from('cursos_academicos').delete().eq('centro_id', id)
  await svc.from('familias').delete().eq('centro_id', id)
  await svc.from('roles_usuario').delete().eq('centro_id', id)
  await svc.from('invitaciones').delete().eq('centro_id', id)

  const { error } = await svc.from('centros').delete().eq('id', id)
  if (error) {
    console.error(`deleteTestCentro(${id}) falló: ${formatSupabaseError(error)}`)
  }
}

export async function asignarRol(
  usuario_id: string,
  centro_id: string,
  rol: 'admin' | 'profe' | 'tutor_legal' | 'autorizado'
): Promise<void> {
  const { error } = await serviceClient.from('roles_usuario').insert({ usuario_id, centro_id, rol })
  if (error) throw new Error(`asignarRol falló: ${error.message}`)
}

export interface TestCurso {
  id: string
  centro_id: string
}

export async function createTestCurso(
  centro_id: string,
  estado: 'planificado' | 'activo' | 'cerrado' = 'activo'
): Promise<TestCurso> {
  const nombre = `Curso-${randomUUID().slice(0, 8)}`
  const { data, error } = await serviceClient
    .from('cursos_academicos')
    .insert({
      centro_id,
      nombre,
      fecha_inicio: '2026-09-01',
      fecha_fin: '2027-07-31',
      estado,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`createTestCurso falló: ${error?.message}`)
  return { id: data.id, centro_id }
}

export interface TestAula {
  id: string
  centro_id: string
  curso_academico_id: string
}

export async function createTestAula(
  centro_id: string,
  curso_academico_id: string,
  nombre?: string,
  cohorte: number[] = [2024]
): Promise<TestAula> {
  const finalNombre = nombre ?? `Aula-${randomUUID().slice(0, 8)}`
  // F11-H: el aula física (aulas) y su configuración por curso (aulas_curso) son
  // dos filas. El fixture crea ambas para el curso dado.
  const { data, error } = await serviceClient
    .from('aulas')
    .insert({ centro_id, nombre: finalNombre })
    .select('id')
    .single()
  if (error || !data) throw new Error(`createTestAula falló: ${error?.message}`)

  const { error: cursoErr } = await serviceClient.from('aulas_curso').insert({
    centro_id,
    aula_id: data.id,
    curso_academico_id,
    tramo_edad: cohorte,
    capacidad: 12,
  })
  if (cursoErr) throw new Error(`createTestAula (aulas_curso) falló: ${cursoErr.message}`)

  return { id: data.id, centro_id, curso_academico_id }
}

export interface TestNino {
  id: string
  centro_id: string
}

export async function createTestNino(centro_id: string, nombre?: string): Promise<TestNino> {
  const finalNombre = nombre ?? `NinoTest-${randomUUID().slice(0, 8)}`
  const { data, error } = await serviceClient
    .from('ninos')
    .insert({
      centro_id,
      nombre: finalNombre,
      apellidos: 'Apellido Test',
      fecha_nacimiento: '2024-03-15',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`createTestNino falló: ${error?.message}`)
  return { id: data.id, centro_id }
}

export async function matricular(
  nino_id: string,
  aula_id: string,
  curso_academico_id: string
): Promise<string> {
  const { data, error } = await serviceClient
    .from('matriculas')
    .insert({ nino_id, aula_id, curso_academico_id, fecha_alta: '2026-09-01' })
    .select('id')
    .single()
  if (error || !data) throw new Error(`matricular falló: ${error?.message}`)
  return data.id
}

export async function asignarProfeAula(
  profe_id: string,
  aula_id: string,
  curso_academico_id?: string
): Promise<string> {
  // F11-H: la asignación es por (aula, curso). Si no se pasa el curso, se deriva
  // del aulas_curso del aula (los fixtures crean una sola config por aula).
  let curso = curso_academico_id
  if (!curso) {
    const { data: ac } = await serviceClient
      .from('aulas_curso')
      .select('curso_academico_id')
      .eq('aula_id', aula_id)
      .limit(1)
      .maybeSingle()
    if (!ac) throw new Error(`asignarProfeAula falló: aula ${aula_id} sin aulas_curso`)
    curso = ac.curso_academico_id
  }
  const { data, error } = await serviceClient
    .from('profes_aulas')
    .insert({ profe_id, aula_id, curso_academico_id: curso, fecha_inicio: '2026-09-01' })
    .select('id')
    .single()
  if (error || !data) throw new Error(`asignarProfeAula falló: ${error?.message}`)
  return data.id
}

export async function crearVinculo(
  nino_id: string,
  usuario_id: string,
  tipo: 'tutor_legal_principal' | 'tutor_legal_secundario' | 'autorizado',
  permisos: Record<string, boolean> = {}
): Promise<string> {
  const { data, error } = await serviceClient
    .from('vinculos_familiares')
    .insert({
      nino_id,
      usuario_id,
      tipo_vinculo: tipo,
      parentesco: tipo === 'autorizado' ? 'otro' : 'madre',
      descripcion_parentesco: tipo === 'autorizado' ? 'cuidadora del centro' : null,
      permisos,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`crearVinculo falló: ${error?.message}`)
  return data.id
}
