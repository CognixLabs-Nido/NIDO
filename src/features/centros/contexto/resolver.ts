/**
 * Reglas del centro activo (multicentro · Fase 1). Módulo puro: sin BD, sin cookies, sin Next.
 * Lo usa `get-contexto-centro.ts`, que le pasa las filas de `roles_usuario` del usuario y el
 * valor de la cookie.
 *
 * Las reglas:
 *  - sin roles activos → `sin_centro`;
 *  - UN centro → ese, siempre. La cookie no se mira: quien tiene un centro no ve selector nunca;
 *  - VARIOS centros → el de la cookie si es uno de los suyos; si no, `elegir`. Nunca se coge uno
 *    por defecto (MisterFC #755: el «primero» elegía el centro equivocado y escribía en él);
 *  - el superusuario (Fase 3) tiene todos los centros y elige siempre, aunque haya uno solo.
 *
 * Roles (PR 3 del modelo de roles): en la app, `admin` es **Dirección**, la admin del centro o
 * una directora, igual que `es_admin` en la BD. La fila `directora` de `roles_usuario` se lee
 * aquí como `admin`, y es el ÚNICO sitio que la traduce: todo `rol === 'admin'` de la app es
 * Dirección. Lo exclusivo de la admin (`privado.es_responsable` en la BD) va por `esResponsable`.
 */

export type Rol = 'admin' | 'profe' | 'tutor_legal' | 'autorizado'

export interface CentroDelUsuario {
  centroId: string
  /** El rol con más privilegios del usuario en ese centro (admin > profe > tutor_legal > autorizado). */
  rol: Rol
  /** Todos sus roles activos en ese centro, de más a menos privilegios. */
  roles: Rol[]
  /**
   * La admin del centro (fila `admin` viva) o el superusuario: lo exclusivo de la admin, como
   * `privado.es_responsable` en la BD. Una directora es Dirección (`rol: 'admin'`) sin esto.
   */
  esResponsable: boolean
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

/** La fila de `roles_usuario` como rol de la app: la directora es Dirección (`admin`). */
export function rolDeLaApp(valor: string): Rol | null {
  return esRol(valor) ? valor : null
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
  const responsableEn = new Set<string>()
  for (const { centro_id, rol } of filas) {
    const deLaApp = rolDeLaApp(rol)
    if (!deLaApp) continue
    const roles = porCentro.get(centro_id) ?? new Set<Rol>()
    roles.add(deLaApp)
    porCentro.set(centro_id, roles)
    if (rol === 'admin') responsableEn.add(centro_id)
  }
  return [...porCentro.entries()]
    .map(([centroId, set]) => {
      const roles = [...set].sort((a, b) => PRIORIDAD_ROL[b] - PRIORIDAD_ROL[a])
      return { centroId, rol: roles[0]!, roles, esResponsable: responsableEn.has(centroId) }
    })
    .sort((a, b) => (a.centroId < b.centroId ? -1 : a.centroId > b.centroId ? 1 : 0))
}

/**
 * Los centros del superusuario (Fase 3, ADR-0061): es admin en TODOS los que existen, además de
 * los roles propios que tenga en alguno, y responsable en todos (como `es_responsable`). Mismo
 * orden estable por `centroId`.
 */
export function centrosDelSuperusuario(
  propios: ReadonlyArray<CentroDelUsuario>,
  todos: ReadonlyArray<string>
): CentroDelUsuario[] {
  const porCentro = new Map(propios.map((c) => [c.centroId, c.roles]))
  return [...new Set([...todos, ...porCentro.keys()])]
    .map((centroId) => {
      const roles = [...new Set<Rol>(['admin', ...(porCentro.get(centroId) ?? [])])].sort(
        (a, b) => PRIORIDAD_ROL[b] - PRIORIDAD_ROL[a]
      )
      return { centroId, rol: roles[0]!, roles, esResponsable: true }
    })
    .sort((a, b) => (a.centroId < b.centroId ? -1 : a.centroId > b.centroId ? 1 : 0))
}

/**
 * `exigirEleccion`: el superusuario no entra en ningún centro sin elegirlo, aunque solo haya uno.
 * Elegir pasa por `elegirCentro`, que deja su entrada en `audit_log`.
 */
export function resolverCentroActivo(
  centros: ReadonlyArray<CentroDelUsuario>,
  cookie: string | undefined,
  opciones: { exigirEleccion?: boolean } = {}
): ResultadoCentroActivo {
  if (centros.length === 0) return { tipo: 'sin_centro' }
  const lista = [...centros]
  if (lista.length === 1 && !opciones.exigirEleccion) {
    return { tipo: 'activo', centro: lista[0]!, centros: lista }
  }
  const elegido = cookie ? lista.find((c) => c.centroId === cookie) : undefined
  return elegido
    ? { tipo: 'activo', centro: elegido, centros: lista }
    : { tipo: 'elegir', centros: lista }
}
