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
  const attempts = opts.attempts ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 1000
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

export async function deleteTestUser(userId: string): Promise<void> {
  await serviceClient.auth.admin.deleteUser(userId).catch(() => {
    /* ignore */
  })
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
  // hard delete: el centro va con cascade implícito de los datos creados arriba.
  // RESTRICT en roles_usuario y otras tablas obliga a limpiar dependencias antes.
  await serviceClient.from('centros').delete().eq('id', id)
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
  const { data, error } = await serviceClient
    .from('aulas')
    .insert({
      centro_id,
      curso_academico_id,
      nombre: finalNombre,
      cohorte_anos_nacimiento: cohorte,
      capacidad_maxima: 12,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`createTestAula falló: ${error?.message}`)
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

export async function asignarProfeAula(profe_id: string, aula_id: string): Promise<string> {
  const { data, error } = await serviceClient
    .from('profes_aulas')
    .insert({ profe_id, aula_id, fecha_inicio: '2026-09-01' })
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
