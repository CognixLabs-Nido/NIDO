import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReactElement } from 'react'

import type { Database } from '@/types/db'

/**
 * Una lectura que falla, para los tests de «no se guarda lo que no se leyó» (2026-11-12). La sesión es
 * la real de quien actúa; solo la lectura que se nombra contesta error, mientras `falla*` esté puesto.
 * Se usa desde el `vi.mock` de `@/lib/supabase/server` con un objeto de `vi.hoisted`.
 */
export interface SesionConFallos {
  actual: SupabaseClient<Database> | null
  /** Tabla cuyas lecturas (`from(tabla)…`) contestan error. */
  fallaTabla: string | null
  /** Función (`rpc(nombre)`) que contesta error. */
  fallaRpc: string | null
  /** Cuántas veces entró el fallo: la premisa de cada test. */
  fallidas: number
}

const RESPUESTA_FALLIDA = {
  data: null,
  error: { message: 'fallo simulado', code: 'XX000', details: '', hint: '' },
  count: null,
  status: 500,
  statusText: 'simulado',
}

export function clienteConFallos(s: SesionConFallos): SupabaseClient<Database> {
  if (!s.actual) throw new Error('test: falta la sesión de quien actúa')
  const real = s.actual
  // Una cadena de PostgREST que acaba en error, sea cual sea el método al que se llame.
  const cadena = (): object => {
    const p: object = new Proxy(
      {},
      {
        get(_t, k) {
          if (k === 'then') {
            s.fallidas++
            return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
              Promise.resolve(RESPUESTA_FALLIDA).then(ok, ko)
          }
          return () => p
        },
      }
    )
    return p
  }
  return new Proxy(real, {
    get(t, p, r) {
      if (p === 'from')
        return (tabla: string) => (tabla === s.fallaTabla ? cadena() : t.from(tabla as never))
      if (p === 'rpc')
        return (fn: string, args?: unknown, opts?: unknown) => {
          if (fn === s.fallaRpc) {
            s.fallidas++
            return Promise.resolve(RESPUESTA_FALLIDA)
          }
          // @ts-expect-error -- reenvío genérico a la rpc real
          return t.rpc(fn, args, opts)
        }
      return Reflect.get(t, p, r)
    },
  })
}

/** Las props del primer elemento de tipo `tipo` en el árbol que devuelve una página de servidor. */
export function propsDe<P>(n: unknown, tipo: unknown): P | null {
  if (!n || typeof n !== 'object') return null
  if (Array.isArray(n)) {
    for (const x of n) {
      const r = propsDe<P>(x, tipo)
      if (r) return r
    }
    return null
  }
  const el = n as ReactElement<{ children?: unknown }>
  if (el.type === tipo) return el.props as unknown as P
  return propsDe<P>(el.props?.children, tipo)
}

/** ¿Hay en el árbol un elemento con este `data-testid`? */
export function hayTestId(n: unknown, id: string): boolean {
  if (!n || typeof n !== 'object') return false
  if (Array.isArray(n)) return n.some((x) => hayTestId(x, id))
  const el = n as ReactElement<{ children?: unknown; 'data-testid'?: string }>
  if (el.props?.['data-testid'] === id) return true
  return hayTestId(el.props?.children, id)
}
