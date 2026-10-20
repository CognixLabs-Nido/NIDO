import 'server-only'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

import { COOKIE_CENTRO_ACTIVO } from './cookie'
import { resolverCentroActivo, type CentroDelUsuario, type Rol } from './resolver'
import { CABECERA_RUTA_PEDIDA } from './ruta-pedida'
import { esSuperusuario, leerCentrosDe } from './roles-del-usuario'

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
  /** Superusuario de plataforma (Fase 3, ADR-0061): admin de todos los centros. */
  esSuperusuario: boolean
  /** Todos los centros del usuario; más de uno ⇒ se enseña el conmutador. */
  centros: CentroDelUsuario[]
}

export type EstadoCentro =
  | { tipo: 'sin_sesion' }
  | { tipo: 'sin_centro' }
  | { tipo: 'elegir'; centros: CentroDelUsuario[]; esSuperusuario: boolean }
  | { tipo: 'activo'; contexto: ContextoCentro }

/**
 * Los centros del usuario actual (una lectura por petición) y si es superusuario. `null` sin
 * sesión. El superusuario tiene todos los centros, como admin (`leerCentrosDe`).
 */
const leerCentrosDelUsuario = cache(
  async (): Promise<{ centros: CentroDelUsuario[]; esSuperusuario: boolean } | null> => {
    const supabase = await createClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) return null

    // Un fallo de lectura cuenta como «sin roles» (→ forbidden), como antes.
    const [centros, esSuper] = await Promise.all([
      leerCentrosDe(supabase, userData.user.id),
      esSuperusuario(supabase),
    ])
    return { centros: centros ?? [], esSuperusuario: esSuper }
  }
)

export const getEstadoCentro = cache(async (): Promise<EstadoCentro> => {
  const leido = await leerCentrosDelUsuario()
  if (leido === null) return { tipo: 'sin_sesion' }
  const { centros, esSuperusuario: esSuper } = leido

  const cookie = (await cookies()).get(COOKIE_CENTRO_ACTIVO)?.value
  // El superusuario elige siempre (su entrada se audita al elegir), aunque haya un solo centro.
  const r = resolverCentroActivo(centros, cookie, { exigirEleccion: esSuper })
  if (r.tipo === 'sin_centro') return r
  if (r.tipo === 'elegir') return { ...r, esSuperusuario: esSuper }
  return {
    tipo: 'activo',
    contexto: {
      centroId: r.centro.centroId,
      rol: r.centro.rol,
      roles: r.centro.roles,
      esSuperusuario: esSuper,
      centros,
    },
  }
})

/**
 * Para páginas y layouts: devuelve el contexto o redirige. Sin sesión → login; sin roles →
 * forbidden; con varios centros y sin elegir → selector (y vuelve a `returnTo` al elegir). Sin
 * `returnTo`, vuelve a la ruta que se pidió (`CABECERA_RUTA_PEDIDA`, la pone el proxy): una
 * notificación abierta sin centro elegido acaba en el aviso, no en el inicio.
 */
export async function requireContextoCentro(
  locale: string,
  returnTo?: string
): Promise<ContextoCentro> {
  const estado = await getEstadoCentro()
  if (estado.tipo === 'activo') return estado.contexto
  if (estado.tipo === 'sin_sesion') redirect(`/${locale}/login`)
  if (estado.tipo === 'sin_centro') redirect(`/${locale}/forbidden`)
  const vuelta = returnTo ?? (await headers()).get(CABECERA_RUTA_PEDIDA)
  const q = vuelta ? `?returnTo=${encodeURIComponent(vuelta)}` : ''
  redirect(`/${locale}/elegir-centro${q}`)
}

/**
 * Para acciones con el centro explícito: el contexto del usuario EN ese centro, o `null` si no
 * tiene rol activo en él. No lee la cookie.
 */
export async function contextoEnCentro(centroId: string): Promise<ContextoCentro | null> {
  const leido = await leerCentrosDelUsuario()
  const centro = leido?.centros.find((c) => c.centroId === centroId)
  if (!leido || !centro) return null
  return {
    centroId,
    rol: centro.rol,
    roles: centro.roles,
    esSuperusuario: leido.esSuperusuario,
    centros: leido.centros,
  }
}
