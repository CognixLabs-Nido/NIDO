import 'server-only'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

import { COOKIE_CENTRO_ACTIVO } from './cookie'
import {
  centrosDelUsuario,
  resolverCentroActivo,
  type CentroDelUsuario,
  type Rol,
} from './resolver'

/**
 * Punto único de la app para saber en qué centro está el usuario (multicentro · Fase 1).
 *
 * Es el ÚNICO sitio que lee los roles del usuario actual para sacar su centro: el guard
 * `scripts/check-centro-activo.mjs` lo hace cumplir. Dos entradas:
 *
 *  - `getEstadoCentro()` / `requireContextoCentro(locale)`: para las páginas y layouts. El centro
 *    sale de la cookie validada (`resolverCentroActivo`).
 *  - `contextoEnCentro(centroId)`: para las acciones que reciben el centro EXPLÍCITO (de la página
 *    o del registro que tocan). No mira la cookie: una pestaña antigua actúa sobre el centro que
 *    enseña, no sobre el último elegido en otra pestaña.
 *
 * La BD sigue autorizando por RLS: esto decide QUÉ centro, no da permisos.
 */

export interface ContextoCentro {
  centroId: string
  rol: Rol
  /** Todos sus roles activos en este centro, de más a menos privilegios. */
  roles: Rol[]
  /** Superusuario de plataforma (Fase 3). Hoy siempre `false`. */
  esSuperusuario: boolean
  /** Todos los centros del usuario; más de uno ⇒ se enseña el conmutador. */
  centros: CentroDelUsuario[]
}

export type EstadoCentro =
  | { tipo: 'sin_sesion' }
  | { tipo: 'sin_centro' }
  | { tipo: 'elegir'; centros: CentroDelUsuario[] }
  | { tipo: 'activo'; contexto: ContextoCentro }

/** Los centros del usuario actual (una consulta por petición). `null` sin sesión. */
const leerCentrosDelUsuario = cache(async (): Promise<CentroDelUsuario[] | null> => {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null

  const { data } = await supabase
    .from('roles_usuario')
    .select('centro_id, rol')
    .eq('usuario_id', userData.user.id)
    .is('deleted_at', null)

  return centrosDelUsuario(data ?? [])
})

export const getEstadoCentro = cache(async (): Promise<EstadoCentro> => {
  const centros = await leerCentrosDelUsuario()
  if (centros === null) return { tipo: 'sin_sesion' }

  const cookie = (await cookies()).get(COOKIE_CENTRO_ACTIVO)?.value
  const r = resolverCentroActivo(centros, cookie)
  if (r.tipo !== 'activo') return r
  return {
    tipo: 'activo',
    contexto: {
      centroId: r.centro.centroId,
      rol: r.centro.rol,
      roles: r.centro.roles,
      esSuperusuario: false,
      centros,
    },
  }
})

/**
 * Para páginas y layouts: devuelve el contexto o redirige. Sin sesión → login; sin roles →
 * forbidden; con varios centros y sin elegir → selector (y vuelve a `returnTo` al elegir).
 */
export async function requireContextoCentro(
  locale: string,
  returnTo?: string
): Promise<ContextoCentro> {
  const estado = await getEstadoCentro()
  if (estado.tipo === 'activo') return estado.contexto
  if (estado.tipo === 'sin_sesion') redirect(`/${locale}/login`)
  if (estado.tipo === 'sin_centro') redirect(`/${locale}/forbidden`)
  const q = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''
  redirect(`/${locale}/elegir-centro${q}`)
}

/**
 * Para acciones con el centro explícito: el contexto del usuario EN ese centro, o `null` si no
 * tiene rol activo en él. No lee la cookie.
 */
export async function contextoEnCentro(centroId: string): Promise<ContextoCentro | null> {
  const centros = await leerCentrosDelUsuario()
  const centro = centros?.find((c) => c.centroId === centroId)
  if (!centros || !centro) return null
  return { centroId, rol: centro.rol, roles: centro.roles, esSuperusuario: false, centros }
}
