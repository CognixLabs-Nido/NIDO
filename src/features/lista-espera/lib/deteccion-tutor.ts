import { clasificarCuenta } from '@/features/auth/lib/clasificar-cuenta'

/**
 * Alta unificada · U-5 (D7) — detección "familia nueva vs 2.º hijo" por el EMAIL del tutor.
 *
 * El botón único de admisiones pide siempre lo mismo (datos del niño + email del tutor) y es
 * el servidor quien decide qué clase de prospecto nace. Antes eran DOS puertas distintas y la
 * dirección tenía que acertar cuál abrir; equivocarse era justo lo que hacía desaparecer al
 * 2.º hijo de la lista (U-2).
 *
 * Reutiliza EXACTAMENTE la misma regla que ya usa `invitarAlAlta` al promover
 * (`buscar_auth_user_por_email` + ¿tiene roles? → `clasificarCuenta`), de modo que lo que
 * anuncia el diálogo al crear y lo que hace la promoción después no pueden divergir.
 */

export type DeteccionTutor =
  /** Sin email, o email sin cuenta / con cuenta a medias (`stub`) → alta de familia nueva. */
  | 'familia_nueva'
  /** Cuenta operativa CON familia en este centro → 2.º hijo de esa familia. */
  | 'familia_existente'
  /**
   * Cuenta operativa SIN familia en este centro (tutor de otro centro, personal, seguidor…).
   * Se trata igual que `familia_existente` a efectos de datos —se guarda su `usuario_id`—
   * pero se etiqueta aparte para no prometer en pantalla una familia que aquí no existe: al
   * promover, la RPC creará una familia NUEVA en este centro ligada a esa cuenta.
   */
  | 'cuenta_sin_familia_aqui'

export interface SenalesTutor {
  /** ¿Se tecleó un email? Sin él no hay nada que resolver. */
  hayEmail: boolean
  /** ¿Existe fila en `auth.users` para ese email? (`buscar_auth_user_por_email`). */
  cuentaExiste: boolean
  /** ¿Esa cuenta tiene algún rol? Señal de cuenta OPERATIVA, no de invitación a medias. */
  tieneRoles: boolean
  /** ¿Esa cuenta figura como tutor de alguna familia DEL CENTRO actual? */
  familiaEnEsteCentro: boolean
}

/**
 * Regla:
 * - sin email → `familia_nueva` (no hay nada que resolver; es el alta normal de siempre).
 * - `clasificarCuenta` ≠ 'real' → `familia_nueva`. Una cuenta `stub` (invitada pero sin
 *   completar) NO es un tutor existente: sigue el flujo de invitación, igual que en
 *   `invitarAlAlta`.
 * - cuenta 'real' → 2.º hijo. Con familia aquí, `familia_existente`; sin ella,
 *   `cuenta_sin_familia_aqui` (mismo tratamiento, distinta etiqueta).
 */
export function detectarTutor(s: SenalesTutor): DeteccionTutor {
  if (!s.hayEmail) return 'familia_nueva'
  if (clasificarCuenta(s.cuentaExiste, s.tieneRoles) !== 'real') return 'familia_nueva'
  return s.familiaEnEsteCentro ? 'familia_existente' : 'cuenta_sin_familia_aqui'
}

/**
 * ¿Se guarda `lista_espera.tutor_usuario_id` (D1)? Sí en cuanto la cuenta es operativa, tenga
 * o no familia aquí: es la pista EXACTA que evita depender de re-teclear el email al promover.
 */
export function guardaTutorUsuarioId(deteccion: DeteccionTutor): boolean {
  return deteccion !== 'familia_nueva'
}
