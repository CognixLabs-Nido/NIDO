// Casos del codemod lectura-mira-el-error. Cada función es un sitio de `entrada.json`.
import { logger } from '@/shared/lib/logger'

declare const supabase: any
declare function fail(clave: string): { success: false; error: string }
type ActionResult<T> = { success: true; data: T } | { success: false; error: string }

export async function aNoMira() {
  const { data } = await supabase.from('a').select('id')
  return data ?? []
}

export async function aConErrorYaUsado(error: string) {
  const { data: filas } = await supabase.from('b').select('id')
  return { filas, error }
}

export async function aIdentificador() {
  const r = await supabase.rpc('c')
  return r.data ?? 0
}

export async function aPromiseAll() {
  const [{ data: x }, { data: y }] = await Promise.all([
    supabase.from('d').select('id'),
    supabase.from('e').select('id'),
  ])
  return [x, y]
}

export async function bVacio() {
  const { data, error } = await supabase.from('f').select('id')
  if (error) {
    logger.warn('bVacio', error.message)
    return []
  }
  return data
}

export async function bOtraCondicion() {
  const { data, error } = await supabase.from('g').select('id').maybeSingle()
  if (error || !data) return null
  return data
}

export async function accion(): Promise<ActionResult<number>> {
  const { data: cuenta } = await supabase.from('h').select('id')
  const total = 0
  return { success: true, data: (cuenta ?? []).length + total }
}
