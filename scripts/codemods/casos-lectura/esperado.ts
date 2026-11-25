// Casos del codemod lectura-mira-el-error. Cada función es un sitio de `entrada.json`.
import { logger } from '@/shared/lib/logger'
import { LecturaFallida } from '@/shared/lib/lectura-fallida'


declare const supabase: any
declare function fail(clave: string): { success: false; error: string }
type ActionResult<T> = { success: true; data: T } | { success: false; error: string }

export async function aNoMira() {
  const { data, error } = await supabase.from('a').select('id')
  if (error) throw new LecturaFallida('aNoMira', error)
  return data ?? []
}

export async function aConErrorYaUsado(error: string) {
  const { data: filas, error: errorLectura } = await supabase.from('b').select('id')
  if (errorLectura) throw new LecturaFallida('aConErrorYaUsado', errorLectura)
  return { filas, error }
}

export async function aIdentificador() {
  const r = await supabase.rpc('c')
  if (r.error) throw new LecturaFallida('aIdentificador', r.error)
  return r.data ?? 0
}

export async function aPromiseAll() {
  const [{ data: x, error }, { data: y, error: errorLectura }] = await Promise.all([
    supabase.from('d').select('id'),
    supabase.from('e').select('id'),
  ])
  if (error) throw new LecturaFallida('aPromiseAll', error)
  if (errorLectura) throw new LecturaFallida('aPromiseAll', errorLectura)
  return [x, y]
}

export async function bVacio() {
  const { data, error } = await supabase.from('f').select('id')
  if (error) {
    logger.warn('bVacio', error.message)
    throw new LecturaFallida('bVacio', error)
  }
  return data
}

export async function bOtraCondicion() {
  const { data, error } = await supabase.from('g').select('id').maybeSingle()
  if (error || !data) return null
  return data
}

export async function accion(): Promise<ActionResult<number>> {
  const { data: cuenta, error } = await supabase.from('h').select('id')
  if (error) return fail('common.lectura_fallida')
  const total = 0
  return { success: true, data: (cuenta ?? []).length + total }
}
