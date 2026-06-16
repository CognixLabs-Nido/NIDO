/**
 * Clasificación de la cuenta `auth.users` asociada al email de una invitación, para
 * decidir entre el FORMULARIO de alta y el aviso B8 (cuenta existente → "ir a login").
 *
 * Contexto (bug de Fase 1): `sendInvitation` envía el correo vía
 * `auth.admin.inviteUserByEmail`, que PRE-CREA la fila en `auth.users` (estado
 * "invited", sin roles). Sin esta clasificación, todo invitado nuevo "existe" en el
 * instante del envío → la page lo mandaba a B8 en vez del alta, bloqueando TODO el
 * onboarding. La señal fiable de "cuenta real" es tener al menos un `roles_usuario`
 * (es `acceptInvitation`/`acceptPendingInvitation` quien los inserta), no la mera
 * existencia de la fila auth.
 */
export type ClaseCuenta = 'nueva' | 'stub' | 'real'

/**
 * - `nueva`: no hay fila en `auth.users` (email jamás invitado/creado).
 * - `stub` : hay fila (la creó `inviteUserByEmail`) PERO sin roles → alta sin completar.
 * - `real` : hay fila CON al menos un rol → cuenta operativa → B8.
 */
export function clasificarCuenta(authUserExiste: boolean, tieneRoles: boolean): ClaseCuenta {
  if (!authUserExiste) return 'nueva'
  return tieneRoles ? 'real' : 'stub'
}

/** Solo una cuenta `real` va a B8; `nueva` y `stub` ven el formulario de alta. */
export function debeMostrarB8(authUserExiste: boolean, tieneRoles: boolean): boolean {
  return clasificarCuenta(authUserExiste, tieneRoles) === 'real'
}
