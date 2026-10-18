/**
 * Reglas del centro activo (multicentro · Fase 1). Módulo puro: sin BD, sin cookies, sin Next.
 * Lo usa `get-contexto-centro.ts`, que le pasa las filas de `roles_usuario` del usuario y el
 * valor de la cookie.
 *
 * Las reglas:
 *  - sin roles activos → `sin_centro`;
 *  - UN centro → ese, siempre. La cookie no se mira: quien tiene un centro no ve selector nunca;
 *  - VARIOS centros → el de la cookie si es uno de los suyos; si no, `elegir`. Nunca se coge uno
 *    por defecto (MisterFC #755: el «primero» elegía el centro equivocado y escribía en él).
 */

export type Rol = 'admin' | 'profe' | 'tutor_legal' | 'autorizado'

export interface CentroDelUsuario {
  centroId: string
  /** El rol con más privilegios del usuario en ese centro (admin > profe > tutor_legal > autorizado). */
  rol: Rol
  /** Todos sus roles activos en ese centro, de más a menos privilegios. */
  roles: Rol[]
}

export type ResultadoCentroActivo =
  | { tipo: 'sin_centro' }
  | { tipo: 'elegir'; centros: CentroDelUsuario[] }
  | { tipo: 'activo'; centro: CentroDelUsuario; centros: CentroDelUsuario[] }

const PRIORIDAD_ROL: Record<Rol, number> = {
  admin: 4,
  profe: 3,
  tutor_legal: 2,
  autorizado: 1,
}

function esRol(valor: string): valor is Rol {
  return valor in PRIORIDAD_ROL
}

/**
 * Agrupa las filas de `roles_usuario` (ya filtradas a las activas del usuario) por centro, con
 * el rol de más privilegios de cada uno. Orden estable por `centroId`, para que nada dependa del
 * orden en que llegan las filas.
 */
export function centrosDelUsuario(
  filas: ReadonlyArray<{ centro_id: string; rol: string }>
): CentroDelUsuario[] {
  const porCentro = new Map<string, Set<Rol>>()
  for (const { centro_id, rol } of filas) {
    if (!esRol(rol)) continue
    const roles = porCentro.get(centro_id) ?? new Set<Rol>()
    roles.add(rol)
    porCentro.set(centro_id, roles)
  }
  return [...porCentro.entries()]
    .map(([centroId, set]) => {
      const roles = [...set].sort((a, b) => PRIORIDAD_ROL[b] - PRIORIDAD_ROL[a])
      return { centroId, rol: roles[0]!, roles }
    })
    .sort((a, b) => (a.centroId < b.centroId ? -1 : a.centroId > b.centroId ? 1 : 0))
}

export function resolverCentroActivo(
  centros: ReadonlyArray<CentroDelUsuario>,
  cookie: string | undefined
): ResultadoCentroActivo {
  if (centros.length === 0) return { tipo: 'sin_centro' }
  const lista = [...centros]
  if (lista.length === 1) return { tipo: 'activo', centro: lista[0]!, centros: lista }
  const elegido = cookie ? lista.find((c) => c.centroId === cookie) : undefined
  return elegido
    ? { tipo: 'activo', centro: elegido, centros: lista }
    : { tipo: 'elegir', centros: lista }
}
